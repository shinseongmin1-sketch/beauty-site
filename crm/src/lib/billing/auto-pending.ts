// 자동결제 pending 재처리 규칙 (S-3). 외부 의존성 없는 순수 로직 — 토스/DB 호출은 runAutoPending 의 deps 로 주입한다.
// (lib/billing/charge.ts 가 실제 토스·Supabase 로, tests/local 이 가짜 토스·로컬 DB 로 같은 코드를 실행한다)
//
// 원칙 (직접결제 pending 재확인(A-2, 014)과 같은 방식)
//   - 이번 실행에서 새로 만든 결제(is_new)만 바로 결제 요청한다.
//   - 이전 실행에서 결과를 확정하지 못한 pending 은 "다시 결제"하지 않고 먼저 토스에 주문번호로 조회한다.
//       토스 DONE + 금액 일치 → 성공으로 기록 (해지 구독이면 DB 가 canceled 를 유지한 채 결제 기간만 반영)
//       토스 DONE 인데 금액/결제키가 다름 → 구독 상태는 그대로 두고 pending 종료 + 관리자 확인
//       토스 ABORTED/EXPIRED/CANCELED 등 → 실패로 기록 (해지 구독이면 DB 가 상태를 바꾸지 않음)
//       토스에 기록 없음 + 요청 후 충분한 시간 경과 → 지금도 결제해도 되는 상태(retry_allowed)일 때만 같은 멱등키로 다시 요청,
//                                                  아니면(해지·카드 변경·동의 없음 등) 구독 상태 변경 없이 pending 종료(NOT_PROCESSED)
//       조회 실패 / 기록 없음(유예 시간 이내) / 처리 중 → 추측하지 않고 pending 유지
import type { ChargeResult, OrderLookup } from "./toss";

// 토스에 결제 기록이 없을 때 "결제가 일어나지 않았다"고 판단하기까지 기다리는 시간 (직접결제와 같은 값)
export const PENDING_NOT_FOUND_GRACE_SECONDS = 600;

export type AutoPendingRow = {
  payment_id: string;
  business_id: string;
  order_id: string;
  order_name: string;
  amount: number;
  customer_key: string;
  billing_key_enc: string;
  requested_at: string;
  is_new: boolean;
  retry_allowed: boolean;
};

export type AutoPendingAction =
  | { type: "charge" }
  | { type: "record_success"; paymentKey: string; approvedAt: string | null }
  | { type: "record_failure"; code: string; message: string }
  | { type: "close"; code: "NOT_PROCESSED" | "UNEXPECTED_PAYMENT_RESULT"; review: boolean }
  | { type: "wait" };

const FAILED_STATUSES = ["ABORTED", "EXPIRED", "CANCELED", "PARTIAL_CANCELED"];

/** pending 자동결제 1건에 대해 할 일을 정한다. 새 결제가 아니면 lookup(토스 주문번호 조회 결과)이 필요하다. */
export function decideAutoPending(row: AutoPendingRow, lookup: OrderLookup | null, nowMs: number): AutoPendingAction {
  if (row.is_new) return row.retry_allowed ? { type: "charge" } : { type: "close", code: "NOT_PROCESSED", review: false };
  if (!lookup || "error" in lookup) return { type: "wait" };
  if (lookup.found) {
    if (lookup.status === "DONE") {
      return lookup.totalAmount === row.amount && lookup.paymentKey
        ? { type: "record_success", paymentKey: lookup.paymentKey, approvedAt: lookup.approvedAt }
        : { type: "close", code: "UNEXPECTED_PAYMENT_RESULT", review: true };
    }
    if (FAILED_STATUSES.includes(lookup.status)) {
      return { type: "record_failure", code: lookup.status, message: "결제가 완료되지 않았습니다." };
    }
    return { type: "wait" };
  }
  const ageSec = (nowMs - new Date(row.requested_at).getTime()) / 1000;
  if (!(ageSec >= PENDING_NOT_FOUND_GRACE_SECONDS)) return { type: "wait" };
  return row.retry_allowed ? { type: "charge" } : { type: "close", code: "NOT_PROCESSED", review: false };
}

export type RpcResult = { error: { code?: string } | null };

export type AutoPendingDeps = {
  /** 토스 주문번호 조회 (결제 요청 아님) */
  lookup: (orderId: string) => Promise<OrderLookup>;
  /** 토스 빌링 결제 요청(멱등키 = 결제 기록 id) + 결과를 billing_record_result 로 기록 — 기존 processCharge */
  chargeAndRecord: (row: AutoPendingRow) => Promise<ChargeResult>;
  /** 서버 전용 DB 함수 호출 (billing_record_result / billing_close_pending) */
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  now?: () => number;
};

export type AutoPendingOutcome = "paid" | "failed" | "closed" | "unknown";

/** pending 자동결제 1건 처리. 반환: paid / failed / closed(결제 없이 종료) / unknown(pending 유지) */
export async function runAutoPending(row: AutoPendingRow, deps: AutoPendingDeps): Promise<AutoPendingOutcome> {
  const lookup = row.is_new ? null : await deps.lookup(row.order_id);
  const action = decideAutoPending(row, lookup, (deps.now ?? Date.now)());

  switch (action.type) {
    case "charge": {
      const r = await deps.chargeAndRecord(row);
      return r.outcome === "paid" ? "paid" : r.outcome === "failed" ? "failed" : "unknown";
    }
    case "record_success":
    case "record_failure": {
      const { error } = await deps.rpc("billing_record_result", {
        p_payment_id: row.payment_id,
        p_success: action.type === "record_success",
        p_toss_payment_key: action.type === "record_success" ? action.paymentKey : null,
        p_approved_at: action.type === "record_success" ? action.approvedAt : null,
        p_failure_code: action.type === "record_failure" ? action.code : null,
        p_failure_message: action.type === "record_failure" ? action.message : null,
      });
      if (error) return "unknown";
      return action.type === "record_success" ? "paid" : "failed";
    }
    case "close": {
      const { error } = await deps.rpc("billing_close_pending", {
        p_payment_id: row.payment_id,
        p_code: action.code,
        p_review: action.review,
      });
      return error ? "unknown" : "closed";
    }
    case "wait":
      return "unknown";
  }
}

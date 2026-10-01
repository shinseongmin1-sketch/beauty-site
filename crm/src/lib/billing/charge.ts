import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { decryptBillingKey } from "./crypto";
import { chargeBillingKey, getPaymentByOrderId, type ChargeResult } from "./toss";

export type ChargeRow = {
  payment_id: string;
  order_id: string;
  order_name: string;
  amount: number;
  customer_key: string;
  billing_key_enc: string;
};

/**
 * 결제 기록 1건을 토스로 결제하고 결과를 DB 에 반영한다 (service_role 클라이언트 전용).
 * - 금액·주문번호는 DB 가 만든 결제 기록의 값을 그대로 쓴다.
 * - 결과 미확정(네트워크/5xx)이면 DB 를 바꾸지 않고 pending 으로 둔다 → 다음 실행이 같은 멱등키로 다시 확인한다.
 * - 상태 전환(active 연장 / 즉시 expired)은 DB 함수 billing_record_result 가 한다.
 */
export async function processCharge(admin: SupabaseClient, row: ChargeRow): Promise<ChargeResult> {
  let result: ChargeResult;
  try {
    result = await chargeBillingKey({
      billingKey: decryptBillingKey(row.billing_key_enc),
      customerKey: row.customer_key,
      amount: row.amount,
      orderId: row.order_id,
      orderName: row.order_name,
      idempotencyKey: `mn-sub-${row.payment_id}`,
    });
  } catch (e) {
    // 복호화 실패 등 서버 설정 문제: 결제를 시도하지 않았으므로 결과를 확정하지 않는다.
    console.error("[billing] charge setup failed", e instanceof Error ? e.message : e);
    return { outcome: "unknown", code: "SETUP_ERROR" };
  }

  if (result.outcome === "unknown") {
    console.error("[billing] charge result unknown", result.code);
    return result;
  }
  const { error } = await admin.rpc("billing_record_result", {
    p_payment_id: row.payment_id,
    p_success: result.outcome === "paid",
    p_toss_payment_key: result.outcome === "paid" ? result.paymentKey : null,
    p_approved_at: result.outcome === "paid" ? result.approvedAt : null,
    p_failure_code: result.outcome === "failed" ? result.code : null,
    p_failure_message: result.outcome === "failed" ? result.message : null,
  });
  if (error) {
    console.error("[billing] record result failed", error.code);
    return { outcome: "unknown", code: "RECORD_FAILED" };
  }
  return result;
}

// 토스에 결제 기록이 없을 때 "결제가 일어나지 않았다"고 확정하기까지 기다리는 시간 (요청이 아직 처리 중일 수 있음)
export const MANUAL_NOT_FOUND_GRACE_SECONDS = 600;

type PendingManual = { payment_id: string; order_id: string; amount: number; requested_at: string };

/**
 * 결과를 모르는 직접 결제(pending)를 토스 "주문번호 조회"로 확정한다 — 다시 결제 요청하지 않으므로 중복 결제가 없다.
 *  - 토스 DONE + 금액 일치 → 성공 반영 / ABORTED·EXPIRED·CANCELED 등 → 실패 반영
 *  - 토스 기록 없음 + 요청 후 10분 경과 → 결제가 일어나지 않음 → failed(NOT_PROCESSED) → 다시 결제 가능
 *  - 조회 실패·기록 없음(10분 이내) → 추측하지 않고 pending 유지 (다음 재확인에서 다시 조회)
 * 반환: 확정된 건수와 남은 pending 건수
 */
export async function reconcilePendingManual(admin: SupabaseClient, businessId: string | null) {
  const { data, error } = await admin.rpc("billing_pending_manual", { p_business: businessId, p_min_age_seconds: 0 });
  if (error) {
    console.error("[billing] pending lookup failed", error.code);
    return { resolved: 0, pending: -1 };
  }
  let resolved = 0, pending = 0;
  for (const p of (data ?? []) as PendingManual[]) {
    const found = await getPaymentByOrderId(p.order_id);
    let args: Record<string, unknown> | null = null;
    if ("found" in found && found.found) {
      if (found.status === "DONE" && found.totalAmount === p.amount && found.paymentKey) {
        args = { p_success: true, p_toss_payment_key: found.paymentKey, p_approved_at: found.approvedAt, p_failure_code: null, p_failure_message: null };
      } else if (found.status === "DONE") {
        // 승인됐지만 금액/결제키가 우리 기록과 다름 → 성공으로 인정하지 않는다 (관리자 확인 필요)
        args = { p_success: false, p_toss_payment_key: null, p_approved_at: null, p_failure_code: "UNEXPECTED_PAYMENT_RESULT", p_failure_message: "결제 결과가 요청과 일치하지 않습니다." };
      } else if (["ABORTED", "EXPIRED", "CANCELED", "PARTIAL_CANCELED"].includes(found.status)) {
        args = { p_success: false, p_toss_payment_key: null, p_approved_at: null, p_failure_code: found.status, p_failure_message: "결제가 완료되지 않았습니다." };
      }
    } else if ("found" in found && !found.found) {
      const ageSec = (Date.now() - new Date(p.requested_at).getTime()) / 1000;
      if (ageSec >= MANUAL_NOT_FOUND_GRACE_SECONDS) {
        args = { p_success: false, p_toss_payment_key: null, p_approved_at: null, p_failure_code: "NOT_PROCESSED", p_failure_message: "결제 요청이 처리되지 않았습니다." };
      }
    } else {
      console.error("[billing] order lookup failed", found.error);
    }
    if (!args) { pending++; continue; }
    const { error: recErr } = await admin.rpc("billing_record_result", { p_payment_id: p.payment_id, ...args });
    if (recErr) { console.error("[billing] reconcile record failed", recErr.code); pending++; } else resolved++;
  }
  return { resolved, pending };
}

/**
 * 차단 상태 매장의 직접 결제 1건 (서버 내부 전용 — "use server" 파일에 두면 브라우저에서 호출 가능한 액션이 되므로 여기 둔다).
 * businessId 는 반드시 호출하는 쪽이 세션에서 얻은 값이어야 한다. 결과를 쿼리스트링 조각으로 돌려준다.
 * 먼저 이 매장의 결과 미확정 직접 결제를 토스에 조회해 확정한다 (확정되지 않으면 새 결제를 만들지 않는다 → 이중 결제 방지).
 */
export async function chargeManual(businessId: string, cycle: string, consentVersion: string): Promise<string> {
  const admin = await createAdminClient();
  const rec = await reconcilePendingManual(admin, businessId);
  if (rec.pending !== 0) return rec.pending > 0 ? "error=payment_in_progress" : "error=start_failed";
  const { data: sub } = await admin.from("subscriptions").select("status").eq("business_id", businessId).maybeSingle();
  if (rec.resolved > 0 && sub?.status === "active") return "paid=1"; // 확인해 보니 직전 결제가 이미 성공해 있었다
  const { data, error } = await admin.rpc("billing_start_manual", { p_business: businessId, p_cycle: cycle, p_consent_version: consentVersion });
  if (error || !data?.[0]) {
    const known = ["already_active", "payment_method_required", "payment_in_progress", "consent_required"].find((k) => error?.message?.includes(k));
    if (!known) console.error("[billing] start manual failed", error?.code);
    return `error=${known ?? "start_failed"}`;
  }
  const r = await processCharge(admin, data[0] as ChargeRow);
  if (r.outcome === "paid") return "paid=1";
  if (r.outcome === "failed") return `error=payment_failed&code=${encodeURIComponent(r.code)}`;
  return "error=payment_pending";
}

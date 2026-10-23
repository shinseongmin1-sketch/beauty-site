// 구독 "직접 결제" — 토스 결제위젯(1회 결제) 서버 전용 도우미.
// 자동결제(lib/billing/toss.ts, API 개별 연동 키)와 키가 다르다: 결제위젯 연동 키(클라이언트 *_gck_, 시크릿 *_gsk_).
//   NEXT_PUBLIC_TOSS_SUB_WIDGET_CLIENT_KEY / TOSS_SUB_WIDGET_SECRET_KEY  (매니온 본사 상점 키 — 매장 예약결제 키와 별개)
// 운영 배포(Vercel Production)에서는 test_ 키를 받지 않는다 (lib/payment-env.ts).
// paymentKey·시크릿 키는 로그에 남기지 않는다 (오류 코드만).
import type { SupabaseClient } from "@supabase/supabase-js";
import { usablePaymentKey } from "@/lib/payment-env";

const API = "https://api.tosspayments.com/v1";

export function subWidgetClientKey(): string {
  const key = usablePaymentKey(process.env.NEXT_PUBLIC_TOSS_SUB_WIDGET_CLIENT_KEY);
  if (!key || !/^(test|live)_gck_/.test(key)) {
    throw new Error("NEXT_PUBLIC_TOSS_SUB_WIDGET_CLIENT_KEY 가 없거나 결제위젯 연동 키(gck)가 아닙니다.");
  }
  return key;
}

function authHeader() {
  const secret = usablePaymentKey(process.env.TOSS_SUB_WIDGET_SECRET_KEY);
  if (!secret) throw new Error("TOSS_SUB_WIDGET_SECRET_KEY 환경변수가 없거나 이 환경에서 쓸 수 없는 키입니다.");
  return `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;
}

async function call(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* 비정상 응답 */
  }
  return { status: res.status, ok: res.ok, json };
}

export type WidgetConfirmResult =
  | { outcome: "paid"; paymentKey: string; approvedAt: string | null }
  | { outcome: "failed"; code: string; message: string }
  | { outcome: "unknown"; code: string }; // 네트워크/5xx/입금 대기: 결과 미확정 → pending 유지, 주문 조회로 나중에 확정

/**
 * 결제 승인. 금액·주문번호는 우리 DB 값으로 보낸다 (브라우저가 보낸 금액을 믿지 않는다).
 * 성공은 토스 응답의 상태(DONE)·금액·주문번호가 모두 일치할 때만 인정한다. 멱등키 = 결제 기록 id.
 */
export async function confirmWidgetPayment(p: { paymentKey: string; orderId: string; amount: number; idempotencyKey: string }): Promise<WidgetConfirmResult> {
  let r;
  try {
    r = await call("POST", "/payments/confirm", { paymentKey: p.paymentKey, orderId: p.orderId, amount: p.amount }, p.idempotencyKey);
  } catch {
    return { outcome: "unknown", code: "NETWORK_ERROR" };
  }
  if (r.ok) {
    const j = r.json;
    if (j.status === "DONE" && j.totalAmount === p.amount && j.orderId === p.orderId && typeof j.paymentKey === "string") {
      return { outcome: "paid", paymentKey: j.paymentKey, approvedAt: typeof j.approvedAt === "string" ? j.approvedAt : null };
    }
    // 가상계좌 입금 대기 등: 아직 돈이 들어오지 않았다 → 확정하지 않는다
    if (j.status === "WAITING_FOR_DEPOSIT" || j.status === "IN_PROGRESS") return { outcome: "unknown", code: String(j.status) };
    return { outcome: "failed", code: "UNEXPECTED_PAYMENT_RESULT", message: "결제 결과가 요청과 일치하지 않습니다." };
  }
  const code = String(r.json.code ?? r.status);
  if (r.status >= 500 || r.status === 409) return { outcome: "unknown", code };
  return { outcome: "failed", code, message: String(r.json.message ?? "결제에 실패했습니다.") };
}

type PendingWidget = { payment_id: string; order_id: string; amount: number; requested_at: string };

/**
 * 끝나지 않은 직접 결제(pending)를 토스 주문 조회로 확정한다 (다시 결제 요청하지 않음).
 *  - DONE + 금액 일치 → 성공 반영 / ABORTED·EXPIRED·CANCELED → 실패 반영
 *  - 기록 없음 → 결제창을 닫았거나 승인 전(토스가 자동 취소) → 그대로 둔다 (새 결제를 시작하면 DB 가 ABANDONED 로 닫는다)
 *  - 입금 대기(WAITING_FOR_DEPOSIT)·조회 실패 → waiting 으로 센다 (새 결제를 시작하지 않는다)
 */
export async function reconcilePendingWidget(admin: SupabaseClient, businessId: string | null) {
  const { data, error } = await admin.rpc("billing_pending_widget", { p_business: businessId });
  if (error) {
    console.error("[billing] widget pending lookup failed", error.code);
    return { resolved: 0, waiting: -1 };
  }
  let resolved = 0, waiting = 0;
  for (const p of (data ?? []) as PendingWidget[]) {
    let r;
    try {
      r = await call("GET", `/payments/orders/${encodeURIComponent(p.order_id)}`);
    } catch {
      waiting++;
      continue;
    }
    if (r.status === 404) continue; // 승인 안 된 주문 → 새 결제 시작 시 닫힘
    if (!r.ok) { console.error("[billing] widget order lookup failed", String(r.json.code ?? r.status)); waiting++; continue; }
    const j = r.json;
    let args: Record<string, unknown> | null = null;
    if (j.status === "DONE" && j.totalAmount === p.amount && typeof j.paymentKey === "string") {
      args = { p_success: true, p_toss_payment_key: j.paymentKey, p_approved_at: typeof j.approvedAt === "string" ? j.approvedAt : null, p_failure_code: null, p_failure_message: null };
    } else if (j.status === "DONE") {
      args = { p_success: false, p_toss_payment_key: null, p_approved_at: null, p_failure_code: "UNEXPECTED_PAYMENT_RESULT", p_failure_message: "결제 결과가 요청과 일치하지 않습니다." };
    } else if (["ABORTED", "EXPIRED", "CANCELED", "PARTIAL_CANCELED"].includes(String(j.status))) {
      args = { p_success: false, p_toss_payment_key: null, p_approved_at: null, p_failure_code: String(j.status), p_failure_message: "결제가 완료되지 않았습니다." };
    }
    if (!args) { waiting++; continue; }
    const { error: recErr } = await admin.rpc("billing_record_widget_result", { p_payment_id: p.payment_id, ...args });
    if (recErr) { console.error("[billing] widget record failed", recErr.code); waiting++; } else resolved++;
  }
  return { resolved, waiting };
}

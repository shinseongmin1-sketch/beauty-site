import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { decryptBillingKey } from "./crypto";
import { chargeBillingKey, type ChargeResult } from "./toss";

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

/**
 * 차단 상태 매장의 직접 결제 1건 (서버 내부 전용 — "use server" 파일에 두면 브라우저에서 호출 가능한 액션이 되므로 여기 둔다).
 * businessId 는 반드시 호출하는 쪽이 세션에서 얻은 값이어야 한다. 결과를 쿼리스트링 조각으로 돌려준다.
 */
export async function chargeManual(businessId: string, cycle: string): Promise<string> {
  const admin = await createAdminClient();
  const { data, error } = await admin.rpc("billing_start_manual", { p_business: businessId, p_cycle: cycle });
  if (error || !data?.[0]) {
    const known = ["already_active", "payment_method_required", "payment_in_progress"].find((k) => error?.message?.includes(k));
    if (!known) console.error("[billing] start manual failed", error?.code);
    return `error=${known ?? "start_failed"}`;
  }
  const r = await processCharge(admin, data[0] as ChargeRow);
  if (r.outcome === "paid") return "paid=1";
  if (r.outcome === "failed") return `error=payment_failed&code=${encodeURIComponent(r.code)}`;
  return "error=payment_pending";
}

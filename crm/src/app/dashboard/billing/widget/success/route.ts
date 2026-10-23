// 구독 직접 결제(토스 결제위젯) 성공 콜백: ?paymentKey=...&orderId=...&amount=...
// 1) 세션의 대표 확인 → 2) 이 매장의 끝나지 않은 직접 결제 주문인지, 금액이 DB 값과 같은지 확인
// → 3) 서버가 토스 결제 승인(금액은 DB 값) → 4) 결과를 DB 함수로 반영 (기간 연장은 DB 가 계산)
// paymentKey 는 로그에 남기지 않는다.
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { createAdminClient } from "@/lib/supabase/server";
import { confirmWidgetPayment } from "@/lib/billing/widget";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(`${origin}/dashboard/billing?${q}`);

  const { business, profile } = await requireBusinessContext();
  if (profile.role !== "owner") return back("error=forbidden");

  const paymentKey = searchParams.get("paymentKey") ?? "";
  const orderId = searchParams.get("orderId") ?? "";
  const amount = Number(searchParams.get("amount"));
  if (!paymentKey || !orderId || !Number.isFinite(amount)) return back("error=invalid_request");

  const admin = await createAdminClient();
  const { data: pay } = await admin
    .from("subscription_payments")
    .select("id, amount, status, kind")
    .eq("order_id", orderId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!pay || pay.kind !== "widget") return back("error=invalid_request");
  if (pay.status === "paid") return back("paid=1");
  // 새 결제를 시작해 닫힌 주문 등: 승인하지 않는다 (토스가 승인되지 않은 결제를 자동 취소한다)
  if (pay.status !== "pending") return back("error=payment_failed");
  if (pay.amount !== amount) return back("error=invalid_request");

  const r = await confirmWidgetPayment({ paymentKey, orderId, amount: pay.amount, idempotencyKey: `mn-subw-${pay.id}` });
  if (r.outcome === "unknown") {
    console.error("[billing] widget confirm result unknown", r.code);
    return back("error=payment_pending");
  }
  const { error } = await admin.rpc("billing_record_widget_result", {
    p_payment_id: pay.id,
    p_success: r.outcome === "paid",
    p_toss_payment_key: r.outcome === "paid" ? r.paymentKey : null,
    p_approved_at: r.outcome === "paid" ? r.approvedAt : null,
    p_failure_code: r.outcome === "failed" ? r.code : null,
    p_failure_message: r.outcome === "failed" ? r.message : null,
  });
  if (error) {
    console.error("[billing] widget record failed", error.code);
    return back("error=payment_pending");
  }
  revalidatePath("/dashboard", "layout");
  return back(r.outcome === "paid" ? "paid=1" : `error=payment_failed&code=${encodeURIComponent(r.code)}`);
}

import Link from "next/link";
import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import { requireWritable } from "@/lib/subscription";
import { confirmTossPayment, type ConfirmedTossPayment } from "@/lib/toss";

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string }>;
}) {
  const { paymentKey, orderId, amount } = await searchParams;

  // 결제 승인/저장은 대표·관리자만. 직원이 이 주소를 직접 열어도 토스 승인 호출 전에 차단된다.
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "payments");
  requireWritable(subscription);

  if (!paymentKey || !orderId || !amount) {
    return <ResultShell ok={false} title="잘못된 접근입니다." />;
  }

  // 금액은 URL 값이 아니라 서버(DB)에 만들어 둔 결제 기록을 기준으로 한다.
  // 내 매장의 주문이고, 아직 결제 전(ready)이며, URL 금액이 기록과 같을 때만 토스 승인을 요청한다.
  // (금액이 다르면 승인하지 않는다 — 승인되지 않은 결제는 토스에서 자동으로 만료된다)
  const { data: payment } = await supabase
    .from("payments")
    .select("id, amount, status")
    .eq("toss_order_id", orderId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!payment) {
    return <ResultShell ok={false} title="잘못된 접근입니다." description="결제 요청 기록을 찾을 수 없습니다." />;
  }
  if (payment.status === "paid") {
    return <ResultShell ok title="이미 결제가 완료된 주문입니다" />;
  }
  if (payment.status !== "ready" || !Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
    return <ResultShell ok={false} title="결제를 진행할 수 없는 주문입니다." />;
  }
  if (Number(amount) !== payment.amount) {
    return <ResultShell ok={false} title="결제 금액이 주문 금액과 다릅니다" description="결제가 승인되지 않았습니다. 다시 시도해주세요." />;
  }

  let confirmed: ConfirmedTossPayment;
  try {
    confirmed = await confirmTossPayment({
      paymentKey,
      orderId,
      amount: payment.amount,
    });
  } catch (e) {
    return <ResultShell ok={false} title="결제 승인에 실패했습니다" description={e instanceof Error ? e.message : undefined} />;
  }

  // 승인 응답도 주문번호·금액·상태가 우리 기록과 같은지 다시 확인한다.
  if (confirmed.status !== "DONE" || confirmed.orderId !== orderId || confirmed.totalAmount !== payment.amount) {
    console.error("[payments] confirm result mismatch", { status: confirmed.status });
    return <ResultShell ok={false} title="결제 결과 확인이 필요합니다" description="고객센터로 문의해주세요." />;
  }

  // 결제 전(ready) 상태인 이 주문 1건만 결제완료로 바꾸고, 실제로 바뀌었는지 확인한다.
  const { data: updated, error: updateError } = await supabase
    .from("payments")
    .update({
      status: "paid",
      toss_payment_key: paymentKey,
      method: typeof confirmed.method === "string" ? confirmed.method : null,
      paid_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .eq("status", "ready")
    .select("id");

  if (updateError || updated?.length !== 1) {
    console.error("[payments] paid record update failed", { code: updateError?.code, rows: updated?.length ?? 0 });
    return <ResultShell ok={false} title="결제는 승인되었지만 기록하지 못했습니다" description="고객센터로 문의해주세요." />;
  }

  return (
    <ResultShell
      ok
      title="결제가 완료되었습니다"
      description={`${payment.amount.toLocaleString()}원 결제가 정상적으로 처리되었습니다.`}
    />
  );
}

function ResultShell({
  ok,
  title,
  description,
}: {
  ok: boolean;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
            ok ? "bg-status-mint-bg text-status-mint-text" : "bg-red-50 text-red-500"
          }`}
        >
          {ok ? "✓" : "✕"}
        </div>
        <h1 className="text-xl font-bold">{title}</h1>
        {description && <p className="text-sm text-muted">{description}</p>}
        <Link
          href="/dashboard/reservations"
          className="inline-block rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-medium text-white"
        >
          예약 목록으로 돌아가기
        </Link>
      </div>
    </div>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { confirmTossPayment } from "@/lib/toss";

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string }>;
}) {
  const { paymentKey, orderId, amount } = await searchParams;

  if (!paymentKey || !orderId || !amount) {
    return <ResultShell ok={false} title="잘못된 접근입니다." />;
  }

  let result: { ok: boolean; title: string; description?: string };

  try {
    const confirmed = await confirmTossPayment({
      paymentKey,
      orderId,
      amount: Number(amount),
    });

    const supabase = await createClient();
    await supabase
      .from("payments")
      .update({
        status: "paid",
        toss_payment_key: paymentKey,
        method: typeof confirmed.method === "string" ? confirmed.method : null,
        paid_at: new Date().toISOString(),
      })
      .eq("toss_order_id", orderId);

    result = {
      ok: true,
      title: "결제가 완료되었습니다",
      description: `${Number(amount).toLocaleString()}원 결제가 정상적으로 처리되었습니다.`,
    };
  } catch (e) {
    result = {
      ok: false,
      title: "결제 승인에 실패했습니다",
      description: e instanceof Error ? e.message : undefined,
    };
  }

  return <ResultShell ok={result.ok} title={result.title} description={result.description} />;
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
            ok ? "bg-brand-mint-light text-teal-700" : "bg-red-50 text-red-500"
          }`}
        >
          {ok ? "✓" : "✕"}
        </div>
        <h1 className="text-xl font-bold">{title}</h1>
        {description && <p className="text-sm text-muted">{description}</p>}
        <Link
          href="/dashboard/reservations"
          className="inline-block rounded-lg bg-gradient-to-r from-brand-pink to-brand-purple px-4 py-2 text-sm font-medium text-white"
        >
          예약 목록으로 돌아가기
        </Link>
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import { requireBusinessContext } from "@/lib/business";
import { reservationPaymentConfig } from "@/lib/toss";
import { PayWidget } from "./pay-widget";

export default async function ReservationPayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, business } = await requireBusinessContext();

  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, customer:customers(name), service:services(name, price)")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!reservation) notFound();

  const customer = Array.isArray(reservation.customer)
    ? reservation.customer[0]
    : reservation.customer;

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-[26px] font-bold text-foreground">결제하기</h1>
      <div className="rounded-2xl border border-border bg-card p-6">
        {reservationPaymentConfig(business.toss_client_key) ? (
          <PayWidget reservationId={reservation.id} customerName={customer?.name} />
        ) : (
          <p className="text-sm text-muted">예약 결제를 사용할 수 없습니다. 결제 설정이 완료되지 않았습니다.</p>
        )}
      </div>
    </div>
  );
}

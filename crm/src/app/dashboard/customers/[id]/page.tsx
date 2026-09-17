import { notFound } from "next/navigation";
import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import type { Customer, ReservationWithRelations } from "@/lib/types";
import { getScheduleBadge } from "@/lib/status";
import { deleteCustomer, updateCustomerMemo } from "../actions";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, business } = await requireBusinessContext();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle<Customer>();

  if (!customer) notFound();

  const { data: reservations } = await supabase
    .from("reservations")
    .select("*, staff:staff(id,name,color), service:services(id,name,duration_minutes,price)")
    .eq("customer_id", id)
    .order("start_time", { ascending: false })
    .returns<ReservationWithRelations[]>();

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-[26px] font-bold text-foreground">{customer.name}</h1>

      <div className="rounded-2xl border border-border bg-card p-6 text-sm">
        <p className="mb-3">연락처: {customer.phone ?? "-"}</p>
        <form action={updateCustomerMemo.bind(null, customer.id)} className="space-y-2">
          <label className="block font-medium">메모</label>
          <textarea
            name="memo"
            defaultValue={customer.memo ?? ""}
            rows={3}
            className="w-full rounded-lg border border-border px-3 py-2"
          />
          <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-background">
            메모 저장
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <h2 className="border-b border-border p-4 font-semibold">예약 이력</h2>
        {(!reservations || reservations.length === 0) ? (
          <p className="p-6 text-sm text-muted">예약 이력이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
            {reservations.map((r) => {
              const badge = getScheduleBadge(r.status, r.start_time, r.end_time);
              return (
                <li key={r.id} className="flex items-center justify-between p-4 text-sm">
                  <div>
                    <p className="font-medium">{format(new Date(r.start_time), "yyyy-MM-dd HH:mm")}</p>
                    <p className="text-muted">
                      {r.service?.name ?? "-"} · 담당 {r.staff?.name ?? "-"}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form action={deleteCustomer.bind(null, customer.id)}>
        <button type="submit" className="text-sm text-red-500 hover:underline">
          고객 삭제
        </button>
      </form>
    </div>
  );
}

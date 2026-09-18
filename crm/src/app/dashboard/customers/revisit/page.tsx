import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import type { ReservationWithRelations } from "@/lib/types";
import { daysSince, getLastVisit } from "@/lib/customer-stats";
import { RevisitListClient, type RevisitRow } from "./list-client";

export default async function RevisitPage() {
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "revisit");

  const { data: reservations } = await supabase
    .from("reservations")
    .select(
      "customer_id, start_time, status, customer:customers(id,name), staff:staff(id,name), service:services(id,name)"
    )
    .eq("business_id", business.id)
    .eq("status", "completed")
    .not("customer_id", "is", null)
    .returns<ReservationWithRelations[]>();

  const byCustomer = new Map<string, ReservationWithRelations[]>();
  for (const r of reservations ?? []) {
    if (!r.customer_id) continue;
    if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, []);
    byCustomer.get(r.customer_id)!.push(r);
  }

  const rows: RevisitRow[] = [];
  for (const [customerId, list] of byCustomer) {
    const last = getLastVisit(list);
    if (!last || !last.customer) continue;
    rows.push({
      customerId,
      name: last.customer.name,
      lastVisitDate: last.start_time,
      daysSince: daysSince(last.start_time),
      lastService: last.content || last.service?.name || "-",
      lastStaff: last.staff?.name ?? "-",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">재방문 관리</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          마지막 방문일 기준으로 재방문이 필요한 고객을 확인하세요.
        </p>
      </div>

      <RevisitListClient rows={rows} />
    </div>
  );
}

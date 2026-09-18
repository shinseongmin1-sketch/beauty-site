import { endOfDay, format, startOfDay, subMonths } from "date-fns";
import { NO_SHOW_WARNING_MONTHS } from "@/lib/customer-stats";
import { requireBusinessContext } from "@/lib/business";
import type { ReservationWithRelations } from "@/lib/types";
import { ReservationCalendarClient } from "./calendar-client";

const RESERVATION_SELECT =
  "*, customer:customers(id,name,phone), staff:staff(id,name,color), service:services(id,name,duration_minutes,price), group:reservation_groups(id,name), reservation_type:reservation_types(id,name,color)";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    new?: string;
    customerId?: string;
    edit?: string;
    status?: string;
    error?: string;
  }>;
}) {
  const { date, new: newParam, customerId, edit, status, error } = await searchParams;
  const { supabase, business } = await requireBusinessContext();

  const targetDate = date ? new Date(`${date}T00:00:00`) : new Date();
  const dateParam = format(targetDate, "yyyy-MM-dd");
  const dayStart = startOfDay(targetDate).toISOString();
  const dayEnd = endOfDay(targetDate).toISOString();

  const [
    { data: reservationsData },
    { data: customers },
    { data: staff },
    { data: services },
    { data: groups },
    { data: types },
    { data: recentNoShows },
  ] = await Promise.all([
    supabase
      .from("reservations")
      .select(RESERVATION_SELECT)
      .eq("business_id", business.id)
      .gte("start_time", dayStart)
      .lte("start_time", dayEnd)
      .order("start_time", { ascending: true })
      .returns<ReservationWithRelations[]>(),
    supabase.from("customers").select("id,name,phone").eq("business_id", business.id).order("name"),
    supabase
      .from("staff")
      .select("id,name")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("services")
      .select("id,name,duration_minutes,price")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("reservation_groups")
      .select("id,name,description,active")
      .eq("business_id", business.id)
      .order("created_at"),
    supabase
      .from("reservation_types")
      .select("id,name,color,active")
      .eq("business_id", business.id)
      .order("created_at"),
    supabase
      .from("reservations")
      .select("customer_id")
      .eq("business_id", business.id)
      .eq("status", "no_show")
      .gte("start_time", subMonths(new Date(), NO_SHOW_WARNING_MONTHS).toISOString())
      .not("customer_id", "is", null),
  ]);

  const noShowCounts: Record<string, number> = {};
  for (const r of recentNoShows ?? []) {
    if (!r.customer_id) continue;
    noShowCounts[r.customer_id] = (noShowCounts[r.customer_id] ?? 0) + 1;
  }

  return (
    <ReservationCalendarClient
      reservations={reservationsData ?? []}
      selectedDate={dateParam}
      options={{
        customers: customers ?? [],
        staff: staff ?? [],
        services: services ?? [],
        groups: groups ?? [],
        types: types ?? [],
      }}
      initialOpenCreate={newParam === "1"}
      prefillCustomerId={customerId}
      initialEditId={edit}
      initialStatusFilter={status}
      noShowCounts={noShowCounts}
      error={error}
    />
  );
}

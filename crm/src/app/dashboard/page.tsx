import Link from "next/link";
import { endOfDay, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { RESERVATION_STATUS_LABEL, type ReservationWithRelations } from "@/lib/types";

export default async function DashboardHomePage() {
  const { supabase, business } = await requireBusinessContext();

  const now = new Date();
  const todayStart = startOfDay(now).toISOString();
  const todayEnd = endOfDay(now).toISOString();
  const monthStart = startOfMonth(now).toISOString();
  const monthEnd = endOfMonth(now).toISOString();

  const [{ data: todayReservations }, { data: monthPayments }, { count: customerCount }] =
    await Promise.all([
      supabase
        .from("reservations")
        .select(
          "*, customer:customers(id,name,phone), staff:staff(id,name,color), service:services(id,name,duration_minutes,price)"
        )
        .eq("business_id", business.id)
        .gte("start_time", todayStart)
        .lte("start_time", todayEnd)
        .order("start_time", { ascending: true })
        .returns<ReservationWithRelations[]>(),
      supabase
        .from("payments")
        .select("amount")
        .eq("business_id", business.id)
        .eq("status", "paid")
        .gte("paid_at", monthStart)
        .lte("paid_at", monthEnd),
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id),
    ]);

  const monthRevenue = (monthPayments ?? []).reduce((sum, p) => sum + p.amount, 0);
  const reservations = todayReservations ?? [];
  const confirmedCount = reservations.filter((r) => r.status === "confirmed").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">오늘의 현황</h1>
        <p className="text-sm text-muted">{format(now, "yyyy년 M월 d일")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="오늘 예약" value={`${reservations.length}건`} />
        <StatCard label="확정된 예약" value={`${confirmedCount}건`} />
        <StatCard label="이번 달 매출" value={`${monthRevenue.toLocaleString()}원`} />
        <StatCard label="누적 고객" value={`${customerCount ?? 0}명`} />
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-semibold">오늘 예약 목록</h2>
          <Link
            href="/dashboard/reservations/new"
            className="rounded-lg bg-gradient-to-r from-brand-pink to-brand-purple px-3 py-1.5 text-sm font-medium text-white"
          >
            + 새 예약
          </Link>
        </div>
        {reservations.length === 0 ? (
          <p className="p-6 text-sm text-muted">오늘 등록된 예약이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
            {reservations.map((r) => (
              <li key={r.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <p className="font-medium">
                    {format(new Date(r.start_time), "HH:mm")} · {r.customer?.name ?? "미지정"}
                  </p>
                  <p className="text-muted">
                    {r.service?.name ?? "메뉴 미지정"} · 담당 {r.staff?.name ?? "미지정"}
                  </p>
                </div>
                <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium">
                  {RESERVATION_STATUS_LABEL[r.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

import Link from "next/link";
import { endOfDay, format, startOfDay } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import type { ReservationWithRelations } from "@/lib/types";
import { getStatusBadge } from "@/lib/status";
import { updateReservationStatus } from "./actions";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const { supabase, business } = await requireBusinessContext();

  const targetDate = date ? new Date(`${date}T00:00:00`) : new Date();
  const dayStart = startOfDay(targetDate).toISOString();
  const dayEnd = endOfDay(targetDate).toISOString();
  const dateParam = format(targetDate, "yyyy-MM-dd");

  const { data } = await supabase
    .from("reservations")
    .select(
      "*, customer:customers(id,name,phone), staff:staff(id,name,color), service:services(id,name,duration_minutes,price)"
    )
    .eq("business_id", business.id)
    .gte("start_time", dayStart)
    .lte("start_time", dayEnd)
    .order("start_time", { ascending: true })
    .returns<ReservationWithRelations[]>();

  const reservations = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-foreground">예약 관리</h1>
          <p className="mt-1.5 text-[15px] text-muted">날짜별 예약 현황을 확인하고 관리하세요.</p>
        </div>
        <Link
          href="/dashboard/reservations/new"
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          + 새 예약
        </Link>
      </div>

      <form className="flex items-center gap-2" method="get">
        <input
          type="date"
          name="date"
          defaultValue={dateParam}
          className="rounded-2xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-2xl border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-background"
        >
          조회
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-4 font-medium">시간</th>
              <th className="p-4 font-medium">고객</th>
              <th className="p-4 font-medium">메뉴</th>
              <th className="p-4 font-medium">담당자</th>
              <th className="p-4 font-medium">상태</th>
              <th className="p-4 font-medium">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {reservations.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted">
                  해당 날짜에 예약이 없습니다.
                </td>
              </tr>
            )}
            {reservations.map((r) => {
              const badge = getStatusBadge(r.status);
              return (
                <tr key={r.id}>
                  <td className="p-4">
                    <Link href={`/dashboard/reservations/${r.id}`} className="font-medium text-foreground hover:underline">
                      {format(new Date(r.start_time), "HH:mm")} ~{" "}
                      {format(new Date(r.end_time), "HH:mm")}
                    </Link>
                  </td>
                  <td className="p-4 text-foreground">{r.customer?.name ?? "미지정"}</td>
                  <td className="p-4 text-muted">{r.service?.name ?? "-"}</td>
                  <td className="p-4 text-muted">{r.staff?.name ?? "-"}</td>
                  <td className="p-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.bg} ${badge.text}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-3">
                      {r.status !== "confirmed" && r.status !== "completed" && (
                        <form action={updateReservationStatus.bind(null, r.id, "confirmed")}>
                          <button className="text-accent hover:underline">확정</button>
                        </form>
                      )}
                      {r.status !== "completed" && (
                        <form action={updateReservationStatus.bind(null, r.id, "completed")}>
                          <button className="text-status-mint-text hover:underline">완료</button>
                        </form>
                      )}
                      {r.status !== "cancelled" && (
                        <form action={updateReservationStatus.bind(null, r.id, "cancelled")}>
                          <button className="text-red-500 hover:underline">취소</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

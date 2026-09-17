import Link from "next/link";
import { endOfDay, format, startOfDay } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { RESERVATION_STATUS_LABEL, type ReservationWithRelations } from "@/lib/types";
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
        <h1 className="text-2xl font-bold">예약 관리</h1>
        <Link
          href="/dashboard/reservations/new"
          className="rounded-lg bg-gradient-to-r from-brand-pink to-brand-purple px-4 py-2 text-sm font-medium text-white"
        >
          + 새 예약
        </Link>
      </div>

      <form className="flex items-center gap-2" method="get">
        <input
          type="date"
          name="date"
          defaultValue={dateParam}
          className="rounded-lg border border-border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-black/5"
        >
          조회
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/5 text-muted">
            <tr>
              <th className="p-3">시간</th>
              <th className="p-3">고객</th>
              <th className="p-3">메뉴</th>
              <th className="p-3">담당자</th>
              <th className="p-3">상태</th>
              <th className="p-3">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {reservations.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  해당 날짜에 예약이 없습니다.
                </td>
              </tr>
            )}
            {reservations.map((r) => (
              <tr key={r.id}>
                <td className="p-3">
                  <Link href={`/dashboard/reservations/${r.id}`} className="hover:underline">
                    {format(new Date(r.start_time), "HH:mm")} ~{" "}
                    {format(new Date(r.end_time), "HH:mm")}
                  </Link>
                </td>
                <td className="p-3">{r.customer?.name ?? "미지정"}</td>
                <td className="p-3">{r.service?.name ?? "-"}</td>
                <td className="p-3">{r.staff?.name ?? "-"}</td>
                <td className="p-3">
                  <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium">
                    {RESERVATION_STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex gap-2">
                    {r.status !== "confirmed" && r.status !== "completed" && (
                      <form action={updateReservationStatus.bind(null, r.id, "confirmed")}>
                        <button className="text-brand-purple hover:underline">확정</button>
                      </form>
                    )}
                    {r.status !== "completed" && (
                      <form action={updateReservationStatus.bind(null, r.id, "completed")}>
                        <button className="text-brand-mint hover:underline">완료</button>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

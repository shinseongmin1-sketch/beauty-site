import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import type { ReservationWithRelations } from "@/lib/types";
import { getStatusBadge } from "@/lib/status";
import { reservationCode } from "@/lib/phone";
import { deleteReservation, updateReservationStatus } from "../actions";

export default async function ReservationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, business } = await requireBusinessContext();

  const { data: reservation } = await supabase
    .from("reservations")
    .select(
      "*, customer:customers(id,name,phone), staff:staff(id,name,color), service:services(id,name,duration_minutes,price), group:reservation_groups(id,name), reservation_type:reservation_types(id,name,color)"
    )
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle<ReservationWithRelations>();

  if (!reservation) notFound();

  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("reservation_id", id)
    .maybeSingle();

  const statuses: Array<[typeof reservation.status, string]> = [
    ["pending", "예약대기"],
    ["confirmed", "예약완료"],
    ["completed", "완료"],
    ["cancelled", "취소"],
    ["no_show", "노쇼"],
  ];
  const badge = getStatusBadge(reservation.status);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[26px] font-bold text-foreground">예약 상세</h1>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${badge.bg} ${badge.text}`}>
          {badge.label}
        </span>
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-card p-6 text-sm">
        <Row label="예약번호">{reservationCode(reservation.id)}</Row>
        <Row label="일시">
          {format(new Date(reservation.start_time), "yyyy-MM-dd HH:mm")} ~{" "}
          {format(new Date(reservation.end_time), "HH:mm")}
        </Row>
        <Row label="고객">
          {reservation.customer?.name ?? "미지정"} {reservation.customer?.phone ? `· ${reservation.customer.phone}` : ""}
        </Row>
        <Row label="예약내용">
          {reservation.content ||
            (reservation.service
              ? `${reservation.service.name} (${reservation.service.duration_minutes}분 / ${reservation.service.price.toLocaleString()}원)`
              : "미지정")}
        </Row>
        <Row label="예약그룹">{reservation.group?.name ?? "-"}</Row>
        <Row label="예약타입">{reservation.reservation_type?.name ?? (reservation.source === "naver" ? "네이버예약" : "-")}</Row>
        <Row label="담당 직원">{reservation.staff?.name ?? "미지정"}</Row>
        <Row label="메모">{reservation.memo || "-"}</Row>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Link
          href={`/dashboard/reservations?date=${format(new Date(reservation.start_time), "yyyy-MM-dd")}&edit=${reservation.id}`}
          className="rounded-xl border border-border py-2.5 text-center text-sm font-medium hover:bg-background"
        >
          예약 수정
        </Link>
        {reservation.customer ? (
          <Link
            href={`/dashboard/consultations/new?customerId=${reservation.customer.id}`}
            className="rounded-xl border border-border py-2.5 text-center text-sm font-medium hover:bg-background"
          >
            상담 등록
          </Link>
        ) : (
          <span className="rounded-xl border border-border py-2.5 text-center text-sm text-muted">상담 등록</span>
        )}
        {reservation.customer ? (
          <Link
            href={`/dashboard/customers/${reservation.customer.id}`}
            className="rounded-xl border border-border py-2.5 text-center text-sm font-medium hover:bg-background"
          >
            고객 상세
          </Link>
        ) : (
          <span className="rounded-xl border border-border py-2.5 text-center text-sm text-muted">고객 상세</span>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-3 font-semibold">상태 변경</h2>
        <div className="flex flex-wrap gap-2">
          {statuses.map(([value, label]) => (
            <form key={value} action={updateReservationStatus.bind(null, reservation.id, value)}>
              <button
                type="submit"
                disabled={reservation.status === value}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  reservation.status === value
                    ? "bg-background text-muted"
                    : "border border-border hover:bg-background"
                }`}
              >
                {label}
              </button>
            </form>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-3 font-semibold">결제</h2>
        {payment ? (
          <p className="text-sm">
            {payment.amount.toLocaleString()}원 ·{" "}
            {payment.status === "paid" ? "결제완료" : payment.status}
          </p>
        ) : (
          <Link
            href={`/dashboard/reservations/${reservation.id}/pay`}
            className="inline-block rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-medium text-white"
          >
            결제 요청하기
          </Link>
        )}
      </div>

      <form action={deleteReservation.bind(null, reservation.id)}>
        <button type="submit" className="text-sm text-red-500 hover:underline">
          예약 삭제
        </button>
      </form>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

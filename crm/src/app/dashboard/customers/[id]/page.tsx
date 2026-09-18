import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import type {
  ConsultationWithRelations,
  Customer,
  CustomerGrade,
  CustomerTag,
  PaymentWithRelations,
  ReservationWithRelations,
} from "@/lib/types";
import { getScheduleBadge, getConsultationResultBadge, getPaymentBadge } from "@/lib/status";
import { maskPhone } from "@/lib/phone";
import {
  computeReservationStats,
  getLastVisit,
  getRecentNoShowCount,
  getUpcomingReservation,
  hasNoShowWarning,
  NO_SHOW_WARNING_MONTHS,
} from "@/lib/customer-stats";
import { deleteCustomer, updateCustomerMemo, updateCustomerMeta } from "../actions";
import { CustomerTabs } from "./tabs-client";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, business } = await requireBusinessContext();

  const { data: customerRaw } = await supabase
    .from("customers")
    .select("*, grade:customer_grades(id,name), customer_tag_links(tag:customer_tags(id,name))")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!customerRaw) notFound();

  const customer = customerRaw as Customer & {
    grade: { id: string; name: string } | null;
    customer_tag_links: { tag: { id: string; name: string } | null }[];
  };
  const customerTags = customer.customer_tag_links.map((l) => l.tag).filter((t): t is { id: string; name: string } => Boolean(t));

  const [{ data: reservations }, { data: consultations }, { data: payments }, { data: allGrades }, { data: allTags }] =
    await Promise.all([
      supabase
        .from("reservations")
        .select(
          "*, staff:staff(id,name,color), service:services(id,name,duration_minutes,price), group:reservation_groups(id,name), reservation_type:reservation_types(id,name,color)"
        )
        .eq("customer_id", id)
        .order("start_time", { ascending: false })
        .returns<ReservationWithRelations[]>(),
      supabase
        .from("consultations")
        .select("*, staff:staff(id,name,color), type_ref:consultation_types(id,name)")
        .eq("customer_id", id)
        .order("consult_date", { ascending: false })
        .returns<ConsultationWithRelations[]>(),
      supabase
        .from("payments")
        .select(
          "*, customer:customers(id,name,phone), staff:staff(id,name), service:services(id,name), payment_method:payment_methods(id,name)"
        )
        .eq("business_id", business.id)
        .eq("customer_id", id)
        .order("created_at", { ascending: false })
        .returns<PaymentWithRelations[]>(),
      supabase.from("customer_grades").select("*").eq("business_id", business.id).order("created_at").returns<CustomerGrade[]>(),
      supabase.from("customer_tags").select("*").eq("business_id", business.id).order("created_at").returns<CustomerTag[]>(),
    ]);

  const reservationList = reservations ?? [];
  const consultationList = consultations ?? [];
  const paymentList = payments ?? [];
  const grades = allGrades ?? [];
  const tags = allTags ?? [];

  const now = new Date();
  const stats = computeReservationStats(reservationList);
  const totalPaid = paymentList.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amount, 0);
  const lastVisit = getLastVisit(reservationList);
  const nextReservation = getUpcomingReservation(
    reservationList.filter((r) => new Date(r.start_time).getTime() >= now.getTime())
  );
  const noShowWarning = hasNoShowWarning(reservationList);
  const recentNoShowCount = getRecentNoShowCount(reservationList);

  const selectedTagIds = new Set(customerTags.map((t) => t.id));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-foreground">{customer.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {customer.grade && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                {customer.grade.name}
              </span>
            )}
            {customerTags.map((t) => (
              <span key={t.id} className="rounded-full bg-status-gray-bg px-2 py-0.5 text-xs text-status-gray-text">
                {t.name}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-muted">{maskPhone(customer.phone)}</p>
        </div>
        <form action={deleteCustomer.bind(null, customer.id)}>
          <button type="submit" className="text-sm text-red-500 hover:underline">
            고객 삭제
          </button>
        </form>
      </div>

      {noShowWarning && (
        <div className="rounded-2xl border border-status-orange-text/30 bg-status-orange-bg px-4 py-3 text-sm text-status-orange-text">
          ⚠ 최근 노쇼 이력이 있습니다. 최근 {NO_SHOW_WARNING_MONTHS}개월 노쇼 {recentNoShowCount}회
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryStat label="총 예약" value={`${stats.total}회`} />
        <SummaryStat label="방문완료" value={`${stats.completed}회`} />
        <SummaryStat label="취소" value={`${stats.cancelled}회`} />
        <SummaryStat label="노쇼" value={`${stats.noShow}회`} />
        <SummaryStat label="총 결제금액" value={`${totalPaid.toLocaleString()}원`} />
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-muted">
        <span>마지막 방문: {lastVisit ? format(new Date(lastVisit.start_time), "yyyy.MM.dd") : "-"}</span>
        <span>다음 예약: {nextReservation ? format(new Date(nextReservation.start_time), "yyyy.MM.dd HH:mm") : "-"}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link
          href={`/dashboard/reservations?new=1&customerId=${customer.id}`}
          className="rounded-xl bg-accent py-2.5 text-center text-sm font-semibold text-white hover:bg-accent-hover"
        >
          + 예약등록
        </Link>
        <Link
          href={`/dashboard/consultations/new?customerId=${customer.id}`}
          className="rounded-xl border border-border py-2.5 text-center text-sm font-medium hover:bg-background"
        >
          + 상담등록
        </Link>
        <Link
          href={`/dashboard/sales/new?customerId=${customer.id}`}
          className="rounded-xl border border-border py-2.5 text-center text-sm font-medium hover:bg-background"
        >
          + 매출등록
        </Link>
        <Link
          href={`/dashboard/marketing?customerId=${customer.id}&customerName=${encodeURIComponent(customer.name)}`}
          className="rounded-xl border border-border py-2.5 text-center text-sm font-medium hover:bg-background"
        >
          문자보내기
        </Link>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <CustomerTabs
          tabs={[
            {
              key: "basic",
              label: "기본정보",
              content: (
                <div className="space-y-5 p-6 text-sm">
                  <Row label="이름">{customer.name}</Row>
                  <Row label="연락처">{customer.phone ?? "-"}</Row>
                  <Row label="등록일">{format(new Date(customer.created_at), "yyyy.MM.dd")}</Row>

                  <form action={updateCustomerMeta.bind(null, customer.id)} className="space-y-3 border-t border-border pt-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium">고객등급</label>
                      <select
                        name="grade_id"
                        defaultValue={customer.grade_id ?? ""}
                        className="w-full max-w-xs rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <option value="">미지정</option>
                        {grades.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">태그</label>
                      <div className="flex flex-wrap gap-3">
                        {tags.map((t) => (
                          <label key={t.id} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              name="tag_ids"
                              value={t.id}
                              defaultChecked={selectedTagIds.has(t.id)}
                              className="rounded border-border"
                            />
                            {t.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-background">
                      등급/태그 저장
                    </button>
                  </form>
                </div>
              ),
            },
            {
              key: "reservations",
              label: "예약이력",
              content: (
                <div className="px-2 pb-2">
                  {reservationList.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted">예약 이력이 없습니다.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {reservationList.map((r) => {
                        const badge = getScheduleBadge(r.status, r.start_time, r.end_time);
                        return (
                          <li key={r.id}>
                            <Link
                              href={`/dashboard/reservations/${r.id}`}
                              className="flex items-center justify-between gap-3 p-4 text-sm transition-colors hover:bg-background"
                            >
                              <div className="min-w-0">
                                <p className="font-medium text-foreground">
                                  {format(new Date(r.start_time), "yyyy.MM.dd HH:mm")}
                                </p>
                                <p className="truncate text-muted">
                                  {r.content || r.service?.name || "-"} · 담당 {r.staff?.name ?? "-"}
                                  {r.reservation_type ? ` · ${r.reservation_type.name}` : ""}
                                </p>
                              </div>
                              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.bg} ${badge.text}`}>
                                {badge.label}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ),
            },
            {
              key: "consultations",
              label: "상담이력",
              content: (
                <div className="px-2 pb-2">
                  {consultationList.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted">상담 이력이 없습니다.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {consultationList.map((c) => {
                        const badge = getConsultationResultBadge(c.result);
                        return (
                          <li key={c.id} className="p-4 text-sm">
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-foreground">
                                {format(new Date(`${c.consult_date}T00:00:00`), "yyyy.MM.dd")} · {c.type_ref?.name ?? c.type ?? "미지정"}
                              </p>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.bg} ${badge.text}`}>
                                {badge.label}
                              </span>
                            </div>
                            <p className="mt-1.5 text-muted">{c.content || "-"}</p>
                            <p className="mt-1 text-xs text-muted">담당자: {c.staff?.name ?? "-"}</p>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ),
            },
            {
              key: "payments",
              label: "매출이력",
              content: (
                <div className="px-2 pb-2">
                  {paymentList.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted">매출 이력이 없습니다.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {paymentList.map((p) => {
                        const badge = getPaymentBadge(p.status);
                        return (
                          <li key={p.id} className="flex items-center justify-between p-4 text-sm">
                            <div>
                              <p className="font-medium text-foreground">
                                {p.amount.toLocaleString()}원
                                {p.discount_amount > 0 ? ` (할인 ${p.discount_amount.toLocaleString()}원)` : ""}
                              </p>
                              <p className="text-muted">
                                {format(new Date(p.paid_at ?? p.created_at), "yyyy.MM.dd")}
                                {p.service ? ` · ${p.service.name}` : ""}
                                {p.staff ? ` · 담당 ${p.staff.name}` : ""}
                                {p.payment_method?.name || p.method ? ` · ${p.payment_method?.name ?? p.method}` : ""}
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
              ),
            },
            {
              key: "memo",
              label: "메모",
              content: (
                <form action={updateCustomerMemo.bind(null, customer.id)} className="space-y-2 p-6">
                  <label className="block text-sm font-medium">메모</label>
                  <textarea
                    name="memo"
                    defaultValue={customer.memo ?? ""}
                    rows={5}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                  <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-background">
                    메모 저장
                  </button>
                </form>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 text-center">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-[15px] font-bold text-foreground">{value}</p>
    </div>
  );
}

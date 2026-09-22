import Link from "next/link";
import {
  endOfDay,
  format,
  startOfDay,
  subDays,
  subMonths,
} from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { canAccess } from "@/lib/permissions";
import type { ReservationWithRelations } from "@/lib/types";
import { getScheduleBadge } from "@/lib/status";
import { NO_SHOW_WARNING_MONTHS, NO_SHOW_WARNING_THRESHOLD } from "@/lib/customer-stats";
import { ScheduleCard } from "./schedule-card";
import {
  IconCalendar,
  IconUsers,
  IconWallet,
  IconClock,
  IconArrowRight,
  IconSmile,
  IconSearch,
} from "./icons";

interface AttentionItem {
  customerId: string;
  name: string;
  reason: string;
}

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const { supabase, business, profile } = await requireBusinessContext();

  const selectedDate = date ? new Date(`${date}T00:00:00`) : new Date();
  const now = new Date();
  // 직원은 매출 데이터에 접근할 수 없다 (DB 도 차단). 조회 자체를 하지 않고 화면에서도 숨긴다.
  const canSeeSales = canAccess(profile.role, "sales");

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const yesterdayEnd = endOfDay(subDays(now, 1));

  const [
    { data: todayReservations },
    { count: yesterdayCount },
    { data: todayPayments },
    { data: yesterdayPayments },
    { data: recentNoShows },
    { data: completedHistory },
    { data: recentConsultations },
    { data: reservationsAfterConsult },
  ] = await Promise.all([
    supabase
      .from("reservations")
      .select(
        "*, customer:customers(id,name,phone), staff:staff(id,name,color), service:services(id,name,duration_minutes,price)"
      )
      .eq("business_id", business.id)
      .gte("start_time", todayStart.toISOString())
      .lte("start_time", todayEnd.toISOString())
      .order("start_time", { ascending: true })
      .returns<ReservationWithRelations[]>(),
    supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .gte("start_time", yesterdayStart.toISOString())
      .lte("start_time", yesterdayEnd.toISOString()),
    canSeeSales
      ? supabase
          .from("payments")
          .select("amount")
          .eq("business_id", business.id)
          .eq("status", "paid")
          .gte("paid_at", todayStart.toISOString())
          .lte("paid_at", todayEnd.toISOString())
      : Promise.resolve({ data: [] as { amount: number }[] }),
    canSeeSales
      ? supabase
          .from("payments")
          .select("amount")
          .eq("business_id", business.id)
          .eq("status", "paid")
          .gte("paid_at", yesterdayStart.toISOString())
          .lte("paid_at", yesterdayEnd.toISOString())
      : Promise.resolve({ data: [] as { amount: number }[] }),
    supabase
      .from("reservations")
      .select("customer_id, customer:customers(id,name)")
      .eq("business_id", business.id)
      .eq("status", "no_show")
      .gte("start_time", subMonths(now, NO_SHOW_WARNING_MONTHS).toISOString())
      .not("customer_id", "is", null),
    supabase
      .from("reservations")
      .select("customer_id, start_time, customer:customers(id,name)")
      .eq("business_id", business.id)
      .eq("status", "completed")
      .not("customer_id", "is", null),
    supabase
      .from("consultations")
      .select("customer_id, consult_date, customer:customers(id,name)")
      .eq("business_id", business.id)
      .gte("consult_date", format(subDays(now, 120), "yyyy-MM-dd"))
      .not("customer_id", "is", null),
    supabase
      .from("reservations")
      .select("customer_id, start_time")
      .eq("business_id", business.id)
      .not("customer_id", "is", null),
  ]);

  const recent = todayReservations ?? [];
  const todayCount = recent.length;
  const completedCount = recent.filter((r) => r.status === "completed").length;
  const pendingCount = recent.filter((r) => r.status === "pending").length;
  const cancelledCount = recent.filter((r) => r.status === "cancelled").length;
  const noShowCount = recent.filter((r) => r.status === "no_show").length;

  const todayRevenue = (todayPayments ?? []).reduce((sum, p) => sum + p.amount, 0);
  const yesterdayRevenue = (yesterdayPayments ?? []).reduce((sum, p) => sum + p.amount, 0);
  const revenueDelta =
    yesterdayRevenue > 0
      ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
      : todayRevenue > 0
        ? 100
        : 0;
  const reservationDelta = todayCount - (yesterdayCount ?? 0);

  const upcoming = recent.filter(
    (r) => new Date(r.start_time).getTime() >= now.getTime() && r.status !== "cancelled" && r.status !== "no_show"
  );

  // ── 확인이 필요한 고객 ──────────────────────────────────────────────
  const attentionItems: AttentionItem[] = [];

  const noShowByCustomer = new Map<string, { name: string; count: number }>();
  for (const r of recentNoShows ?? []) {
    const c = r.customer as unknown as { id: string; name: string } | null;
    if (!c) continue;
    const entry = noShowByCustomer.get(c.id) ?? { name: c.name, count: 0 };
    entry.count += 1;
    noShowByCustomer.set(c.id, entry);
  }
  for (const [customerId, v] of noShowByCustomer) {
    if (v.count >= NO_SHOW_WARNING_THRESHOLD) {
      attentionItems.push({ customerId, name: v.name, reason: `최근 노쇼 ${v.count}회` });
    }
  }

  const lastVisitByCustomer = new Map<string, { name: string; lastVisit: string }>();
  for (const r of completedHistory ?? []) {
    const c = r.customer as unknown as { id: string; name: string } | null;
    if (!c) continue;
    const existing = lastVisitByCustomer.get(c.id);
    if (!existing || r.start_time > existing.lastVisit) {
      lastVisitByCustomer.set(c.id, { name: c.name, lastVisit: r.start_time });
    }
  }
  for (const [customerId, v] of lastVisitByCustomer) {
    const days = Math.floor((now.getTime() - new Date(v.lastVisit).getTime()) / (1000 * 60 * 60 * 24));
    if (days >= 90) {
      attentionItems.push({ customerId, name: v.name, reason: "90일 이상 미방문" });
    }
  }

  const reservationsByCustomer = new Map<string, string[]>();
  for (const r of reservationsAfterConsult ?? []) {
    if (!r.customer_id) continue;
    if (!reservationsByCustomer.has(r.customer_id)) reservationsByCustomer.set(r.customer_id, []);
    reservationsByCustomer.get(r.customer_id)!.push(r.start_time);
  }
  const latestConsultByCustomer = new Map<string, { name: string; date: string }>();
  for (const c of recentConsultations ?? []) {
    const cust = c.customer as unknown as { id: string; name: string } | null;
    if (!cust) continue;
    const existing = latestConsultByCustomer.get(cust.id);
    if (!existing || c.consult_date > existing.date) {
      latestConsultByCustomer.set(cust.id, { name: cust.name, date: c.consult_date });
    }
  }
  for (const [customerId, v] of latestConsultByCustomer) {
    const reservationsAfter = (reservationsByCustomer.get(customerId) ?? []).filter(
      (t) => t.slice(0, 10) > v.date
    );
    if (reservationsAfter.length === 0) {
      attentionItems.push({
        customerId,
        name: v.name,
        reason: `최근 상담일 ${format(new Date(`${v.date}T00:00:00`), "yyyy.MM.dd")} · 상담 후 예약 없음`,
      });
    }
  }

  const displayName = profile.full_name || "대표";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">
          {displayName}님, 오늘도 좋은 하루 되세요!
        </h1>
        <p className="mt-1.5 text-[15px] text-muted">
          지금까지의 예약 현황을 한눈에 확인해보세요.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Link href="/dashboard/reservations">
          <StatCard
            icon={<IconCalendar className="h-5 w-5" />}
            iconBg="bg-status-blue-bg text-status-blue-text"
            label="오늘 예약"
            value={`${todayCount}건`}
            hint={
              reservationDelta === 0 ? "어제와 동일" : `${reservationDelta > 0 ? "▲" : "▼"} ${Math.abs(reservationDelta)}건`
            }
            positive={reservationDelta >= 0}
          />
        </Link>
        <Link href="/dashboard/reservations?status=completed">
          <StatCard
            icon={<IconUsers className="h-5 w-5" />}
            iconBg="bg-status-mint-bg text-status-mint-text"
            label="방문완료"
            value={`${completedCount}건`}
            hint="오늘 기준"
            positive
          />
        </Link>
        <Link href="/dashboard/reservations?status=pending">
          <StatCard
            icon={<IconClock className="h-5 w-5" />}
            iconBg="bg-status-orange-bg text-status-orange-text"
            label="예약대기"
            value={`${pendingCount}건`}
            hint="확인 필요"
          />
        </Link>
        <Link href="/dashboard/reservations?status=cancelled">
          <StatCard
            icon={<IconClock className="h-5 w-5" />}
            iconBg="bg-status-gray-bg text-status-gray-text"
            label="취소"
            value={`${cancelledCount}건`}
            hint="오늘 기준"
          />
        </Link>
        <Link href="/dashboard/reservations?status=no_show">
          <StatCard
            icon={<IconClock className="h-5 w-5" />}
            iconBg="bg-status-gray-bg text-status-gray-text"
            label="노쇼"
            value={`${noShowCount}건`}
            hint="오늘 기준"
          />
        </Link>
        {canSeeSales && (
          <Link href="/dashboard/sales">
            <StatCard
              icon={<IconWallet className="h-5 w-5" />}
              iconBg="bg-positive-soft text-positive"
              label="오늘 예상매출"
              value={`${todayRevenue.toLocaleString()}원`}
              hint={
                revenueDelta === 0 ? "어제와 동일" : `${revenueDelta > 0 ? "▲" : "▼"} ${Math.abs(revenueDelta)}%`
              }
              positive={revenueDelta >= 0}
            />
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <ScheduleCard supabase={supabase} businessId={business.id} selectedDate={selectedDate} basePath="/dashboard" />

          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-3 text-[15px] font-bold text-foreground">다음 예약</h3>
            {upcoming.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">오늘 남은 예약이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/dashboard/reservations/${r.id}`}
                      className="flex items-center gap-4 py-3 transition-colors hover:bg-background"
                    >
                      <span className="w-14 shrink-0 text-sm font-bold text-foreground">
                        {format(new Date(r.start_time), "HH:mm")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {r.customer?.name ?? "고객 미지정"}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {r.content || r.service?.name || "-"} · {r.staff?.name ?? "미지정"}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-3 text-[15px] font-bold text-foreground">확인이 필요한 고객</h3>
            {attentionItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">확인이 필요한 고객이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-border">
                {attentionItems.slice(0, 8).map((item, i) => (
                  <li key={`${item.customerId}-${i}`}>
                    <Link
                      href={`/dashboard/customers/${item.customerId}`}
                      className="flex items-center gap-2 py-3 text-sm transition-colors hover:bg-background"
                    >
                      <span className="text-status-orange-text">⚠</span>
                      <span className="font-semibold text-foreground">{item.name}</span>
                      <span className="ml-auto text-xs text-muted">{item.reason}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-2.5">
            <Link
              href="/dashboard/reservations/new"
              className="flex items-center justify-between rounded-2xl bg-accent px-5 py-5 font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover"
            >
              <span className="flex items-center gap-3 text-[15px]">
                <IconCalendar className="h-6 w-6" />새 예약하기
              </span>
              <IconArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/dashboard/reservations/search"
              className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 font-semibold text-foreground shadow-sm transition-colors hover:bg-background"
            >
              <span className="flex items-center gap-3 text-[15px]">
                <IconSearch className="h-5 w-5 text-accent" />
                예약고객 검색
              </span>
              <IconArrowRight className="h-5 w-5 text-muted" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <QuickMenu href="/dashboard/reservations" icon={<IconCalendar className="h-5 w-5" />} label="예약 조회" />
            <QuickMenu href="/dashboard/customers" icon={<IconUsers className="h-5 w-5" />} label="고객 등록" />
            {canAccess(profile.role, "revisit") && (
              <QuickMenu href="/dashboard/customers/revisit" icon={<IconClock className="h-5 w-5" />} label="재방문 관리" />
            )}
            {canSeeSales && <QuickMenu href="/dashboard/sales" icon={<IconWallet className="h-5 w-5" />} label="매출 확인" />}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-foreground">오늘 예약 내역</h3>
              <Link
                href="/dashboard/reservations"
                className="flex items-center gap-0.5 text-xs font-medium text-accent hover:underline"
              >
                전체보기 <IconArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">오늘 등록된 예약이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {recent.slice(0, 4).map((r) => {
                  const badge = getScheduleBadge(r.status, r.start_time, r.end_time);
                  const name = r.customer?.name ?? "고객 미지정";
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/dashboard/reservations/${r.id}`}
                        className="flex items-center gap-3 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-background"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                          {name.charAt(0)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
                          <span className="block truncate text-xs text-muted">
                            {r.service?.name ?? "메뉴 미지정"} · {format(new Date(r.start_time), "HH:mm")}
                          </span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-start gap-3 rounded-2xl bg-accent-soft p-5">
            <IconSmile className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
            <p className="text-sm leading-relaxed text-foreground">
              고객의 소중한 시간을
              <br />더 가치있게 만들어보세요.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  iconBg,
  label,
  value,
  hint,
  positive,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  hint: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBg}`}>{icon}</span>
        <p className="text-xs text-muted">{label}</p>
      </div>
      <p className="mt-2.5 text-[22px] font-bold leading-none text-foreground">{value}</p>
      <p
        className={`mt-1.5 text-[11px] font-medium ${
          positive === undefined ? "text-status-orange-text" : positive ? "text-positive" : "text-status-orange-text"
        }`}
      >
        {hint}
      </p>
    </div>
  );
}

function QuickMenu({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-start gap-2.5 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-background"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="text-sm font-medium text-foreground">{label}</span>
    </Link>
  );
}

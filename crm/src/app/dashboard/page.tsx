import Link from "next/link";
import {
  endOfDay,
  endOfWeek,
  startOfDay,
  startOfWeek,
  subDays,
} from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import type { ReservationWithRelations } from "@/lib/types";
import { getScheduleBadge } from "@/lib/status";
import { format } from "date-fns";
import { ScheduleCard } from "./schedule-card";
import {
  IconCalendar,
  IconUsers,
  IconWallet,
  IconClock,
  IconArrowRight,
  IconSmile,
} from "./icons";

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const { supabase, business, profile } = await requireBusinessContext();

  const selectedDate = date ? new Date(`${date}T00:00:00`) : new Date();
  const now = new Date();

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const yesterdayEnd = endOfDay(subDays(now, 1));
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);

  const [
    { data: todayReservations },
    { count: todayCount },
    { count: yesterdayCount },
    { count: customerCount },
    { count: newCustomerThisWeek },
    { data: todayPayments },
    { data: yesterdayPayments },
    { count: pendingCount },
  ] = await Promise.all([
    supabase
      .from("reservations")
      .select(
        "*, customer:customers(id,name,phone), staff:staff(id,name,color), service:services(id,name,duration_minutes,price)"
      )
      .eq("business_id", business.id)
      .gte("start_time", todayStart.toISOString())
      .lte("start_time", todayEnd.toISOString())
      .order("start_time", { ascending: false })
      .limit(4)
      .returns<ReservationWithRelations[]>(),
    supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .gte("start_time", todayStart.toISOString())
      .lte("start_time", todayEnd.toISOString()),
    supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .gte("start_time", yesterdayStart.toISOString())
      .lte("start_time", yesterdayEnd.toISOString()),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .gte("created_at", weekStart.toISOString())
      .lte("created_at", weekEnd.toISOString()),
    supabase
      .from("payments")
      .select("amount")
      .eq("business_id", business.id)
      .eq("status", "paid")
      .gte("paid_at", todayStart.toISOString())
      .lte("paid_at", todayEnd.toISOString()),
    supabase
      .from("payments")
      .select("amount")
      .eq("business_id", business.id)
      .eq("status", "paid")
      .gte("paid_at", yesterdayStart.toISOString())
      .lte("paid_at", yesterdayEnd.toISOString()),
    supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("status", "pending")
      .gte("start_time", todayStart.toISOString()),
  ]);

  const todayRevenue = (todayPayments ?? []).reduce((sum, p) => sum + p.amount, 0);
  const yesterdayRevenue = (yesterdayPayments ?? []).reduce((sum, p) => sum + p.amount, 0);
  const revenueDelta =
    yesterdayRevenue > 0
      ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
      : todayRevenue > 0
        ? 100
        : 0;
  const reservationDelta = (todayCount ?? 0) - (yesterdayCount ?? 0);

  const displayName = profile.full_name || "대표";
  const recent = todayReservations ?? [];

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<IconCalendar className="h-5 w-5" />}
          iconBg="bg-status-blue-bg text-status-blue-text"
          label="오늘 예약"
          value={`${todayCount ?? 0}건`}
          hint={
            reservationDelta === 0
              ? "어제와 동일"
              : `${reservationDelta > 0 ? "▲" : "▼"} ${Math.abs(reservationDelta)}건 (어제 대비)`
          }
          positive={reservationDelta >= 0}
        />
        <StatCard
          icon={<IconUsers className="h-5 w-5" />}
          iconBg="bg-status-mint-bg text-status-mint-text"
          label="전체 고객"
          value={`${customerCount ?? 0}명`}
          hint={`▲ ${newCustomerThisWeek ?? 0}명 (이번 주)`}
          positive
        />
        <StatCard
          icon={<IconWallet className="h-5 w-5" />}
          iconBg="bg-positive-soft text-positive"
          label="오늘 매출"
          value={`${todayRevenue.toLocaleString()}원`}
          hint={
            revenueDelta === 0
              ? "어제와 동일"
              : `${revenueDelta > 0 ? "▲" : "▼"} ${Math.abs(revenueDelta)}% (어제 대비)`
          }
          positive={revenueDelta >= 0}
        />
        <StatCard
          icon={<IconClock className="h-5 w-5" />}
          iconBg="bg-status-orange-bg text-status-orange-text"
          label="예약 대기"
          value={`${pendingCount ?? 0}건`}
          hint="확인 필요"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <ScheduleCard
          supabase={supabase}
          businessId={business.id}
          selectedDate={selectedDate}
          basePath="/dashboard"
        />

        <div className="space-y-6">
          <Link
            href="/dashboard/reservations/new"
            className="flex items-center justify-between rounded-2xl bg-accent px-5 py-5 font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover"
          >
            <span className="flex items-center gap-3 text-[15px]">
              <IconCalendar className="h-6 w-6" />새 예약하기
            </span>
            <IconArrowRight className="h-5 w-5" />
          </Link>

          <div className="grid grid-cols-2 gap-3">
            <QuickMenu href="/dashboard/reservations" icon={<IconCalendar className="h-5 w-5" />} label="예약 조회" />
            <QuickMenu href="/dashboard/customers" icon={<IconUsers className="h-5 w-5" />} label="고객 등록" />
            <QuickMenu href="/dashboard/schedule" icon={<IconClock className="h-5 w-5" />} label="일정 확인" />
            <QuickMenu href="/dashboard/payments" icon={<IconWallet className="h-5 w-5" />} label="매출 확인" />
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-foreground">최근 예약 내역</h3>
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
                {recent.map((r) => {
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
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
          {icon}
        </span>
        <p className="text-sm text-muted">{label}</p>
      </div>
      <p className="mt-3 text-[26px] font-bold leading-none text-foreground">{value}</p>
      <p
        className={`mt-2 text-xs font-medium ${
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

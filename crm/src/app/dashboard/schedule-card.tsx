import Link from "next/link";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { ko } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getScheduleBadge } from "@/lib/status";
import { IconCalendar, IconChevronLeft, IconChevronRight } from "./icons";
import type { ReservationWithRelations } from "@/lib/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dotClassFor(status: string) {
  if (status === "pending") return "bg-status-orange-text";
  if (status === "cancelled" || status === "no_show") return "bg-status-gray-text";
  return "bg-status-blue-text";
}

export async function ScheduleCard({
  supabase,
  businessId,
  selectedDate,
  basePath,
}: {
  supabase: SupabaseClient;
  businessId: string;
  selectedDate: Date;
  basePath: string;
}) {
  const dayStart = startOfDay(selectedDate);
  const dayEnd = addDays(dayStart, 1);
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  const [{ data: dayReservations }, { data: monthReservations }] = await Promise.all([
    supabase
      .from("reservations")
      .select(
        "*, customer:customers(id,name,phone), staff:staff(id,name,color), service:services(id,name,duration_minutes,price)"
      )
      .eq("business_id", businessId)
      .gte("start_time", dayStart.toISOString())
      .lt("start_time", dayEnd.toISOString())
      .order("start_time", { ascending: true })
      .returns<ReservationWithRelations[]>(),
    supabase
      .from("reservations")
      .select("start_time,status")
      .eq("business_id", businessId)
      .gte("start_time", monthStart.toISOString())
      .lte("start_time", monthEnd.toISOString()),
  ]);

  const reservations = dayReservations ?? [];

  const dotsByDay = new Map<string, Set<string>>();
  for (const r of monthReservations ?? []) {
    const key = format(new Date(r.start_time), "yyyy-MM-dd");
    if (!dotsByDay.has(key)) dotsByDay.set(key, new Set());
    dotsByDay.get(key)!.add(dotClassFor(r.status));
  }

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const prevDayHref = `${basePath}?date=${format(subDays(selectedDate, 1), "yyyy-MM-dd")}`;
  const nextDayHref = `${basePath}?date=${format(addDays(selectedDate, 1), "yyyy-MM-dd")}`;
  const todayHref = `${basePath}?date=${format(new Date(), "yyyy-MM-dd")}`;
  const prevMonthHref = `${basePath}?date=${format(startOfMonth(subMonths(selectedDate, 1)), "yyyy-MM-dd")}`;
  const nextMonthHref = `${basePath}?date=${format(startOfMonth(addMonths(selectedDate, 1)), "yyyy-MM-dd")}`;

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <IconCalendar className="h-5 w-5 text-accent" />
          예약 일정
        </h2>
        <div className="flex items-center gap-1 text-sm">
          <Link
            href={prevDayHref}
            aria-label="이전 날"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background"
          >
            <IconChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-[168px] px-1 text-center font-semibold text-foreground">
            {format(selectedDate, "yyyy년 M월 d일 (EEE)", { locale: ko })}
          </span>
          <Link
            href={nextDayHref}
            aria-label="다음 날"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background"
          >
            <IconChevronRight className="h-4 w-4" />
          </Link>
          <Link
            href={todayHref}
            className="ml-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
          >
            오늘
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[280px_1fr]">
        {/* 미니 월간 캘린더 */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <Link href={prevMonthHref} aria-label="이전 달" className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-background">
              <IconChevronLeft className="h-4 w-4" />
            </Link>
            <p className="text-sm font-semibold text-foreground">
              {format(selectedDate, "yyyy년 M월", { locale: ko })}
            </p>
            <Link href={nextMonthHref} aria-label="다음 달" className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-background">
              <IconChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center text-[11px] text-muted">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center text-[13px]">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const selected = isSameDay(day, selectedDate);
              const inMonth = isSameMonth(day, selectedDate);
              const today = isToday(day);
              const dots = Array.from(dotsByDay.get(key) ?? []).slice(0, 3);

              return (
                <Link
                  key={key}
                  href={`${basePath}?date=${key}`}
                  className="flex flex-col items-center gap-0.5 py-1"
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                      selected
                        ? "bg-accent font-semibold text-white"
                        : today
                          ? "border border-accent text-accent font-semibold"
                          : inMonth
                            ? "text-foreground hover:bg-background"
                            : "text-muted/50 hover:bg-background"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  <span className="flex h-1.5 gap-0.5">
                    {dots.map((d, i) => (
                      <span key={i} className={`h-1 w-1 rounded-full ${d}`} />
                    ))}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-xs text-muted">
            <LegendRow className="bg-status-blue-text" label="예약 완료" />
            <LegendRow className="bg-status-mint-text" label="진행 중" />
            <LegendRow className="bg-status-orange-text" label="예약 대기" />
            <LegendRow className="bg-status-gray-text" label="취소" />
          </div>
        </div>

        {/* 시간대별 일정 */}
        <div className="space-y-2.5">
          {reservations.length === 0 ? (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted">
              이 날짜에 등록된 예약이 없습니다.
            </div>
          ) : (
            reservations.map((r) => {
              const badge = getScheduleBadge(r.status, r.start_time, r.end_time);
              return (
                <Link
                  key={r.id}
                  href={`/dashboard/reservations/${r.id}`}
                  className="flex items-stretch gap-4 rounded-xl border border-border p-3.5 transition-colors hover:bg-background"
                >
                  <div className="w-14 shrink-0 pt-0.5 text-sm font-semibold text-foreground">
                    {format(new Date(r.start_time), "HH:mm")}
                  </div>
                  <div className={`flex flex-1 items-center justify-between rounded-lg border-l-4 ${badge.border} ${badge.bg} px-4 py-2.5`}>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {r.customer?.name ?? "고객 미지정"}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {r.service?.name ?? "메뉴 미지정"}
                        {r.service ? ` · ${formatDuration(r.service.duration_minutes)}` : ""}
                      </p>
                    </div>
                    <span
                      className={`ml-3 shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.bg} ${badge.text}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function LegendRow({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </div>
  );
}

function formatDuration(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

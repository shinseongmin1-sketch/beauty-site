import { differenceInCalendarDays, subMonths } from "date-fns";
import type { ReservationWithRelations } from "./types";

export const NO_SHOW_WARNING_THRESHOLD = 2;
export const NO_SHOW_WARNING_MONTHS = 6;

export interface ReservationStats {
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  pending: number;
  confirmed: number;
}

export function computeReservationStats(reservations: { status: string }[]): ReservationStats {
  const stats: ReservationStats = { total: 0, completed: 0, cancelled: 0, noShow: 0, pending: 0, confirmed: 0 };
  for (const r of reservations) {
    stats.total += 1;
    if (r.status === "completed") stats.completed += 1;
    else if (r.status === "cancelled") stats.cancelled += 1;
    else if (r.status === "no_show") stats.noShow += 1;
    else if (r.status === "pending") stats.pending += 1;
    else if (r.status === "confirmed") stats.confirmed += 1;
  }
  return stats;
}

export function getRecentNoShowCount(
  reservations: { status: string; start_time: string }[],
  months = NO_SHOW_WARNING_MONTHS,
  now: Date = new Date()
): number {
  const cutoff = subMonths(now, months);
  return reservations.filter((r) => r.status === "no_show" && new Date(r.start_time) >= cutoff).length;
}

export function hasNoShowWarning(reservations: { status: string; start_time: string }[], now: Date = new Date()) {
  return getRecentNoShowCount(reservations, NO_SHOW_WARNING_MONTHS, now) >= NO_SHOW_WARNING_THRESHOLD;
}

export function getLastVisit(reservations: ReservationWithRelations[]): ReservationWithRelations | null {
  const completed = reservations
    .filter((r) => r.status === "completed")
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  return completed[0] ?? null;
}

export function daysSince(dateStr: string, now: Date = new Date()): number {
  return differenceInCalendarDays(now, new Date(dateStr));
}

export function getUpcomingReservation(reservations: ReservationWithRelations[]): ReservationWithRelations | null {
  const upcoming = reservations
    .filter((r) => r.status !== "cancelled" && r.status !== "no_show")
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  return upcoming[0] ?? null;
}

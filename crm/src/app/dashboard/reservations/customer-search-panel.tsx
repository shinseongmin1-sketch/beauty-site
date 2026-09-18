"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { maskPhone, reservationCode } from "@/lib/phone";
import { getStatusBadge } from "@/lib/status";
import { IconSearch } from "../icons";
import { searchReservationCustomers, type ReservationSearchResult } from "./actions";
import type { ReservationWithRelations } from "@/lib/types";

/**
 * "예약고객 검색"의 핵심 UI. 고객이 매장에 방문해서 "예약했는데요"라고 할 때
 * 이름/연락처/예약번호로 바로 찾아서, 오늘 예약 여부를 최상단에 크게 보여준다.
 * 예약관리 화면의 슬라이드 패널과 /dashboard/reservations/search 페이지에서 공용으로 쓴다.
 */
export function CustomerSearchPanel({
  onViewReservation,
  onRegisterCustomer,
  autoFocus,
}: {
  onViewReservation?: (reservation: ReservationWithRelations) => void;
  onRegisterCustomer?: (customer: { id?: string; name: string; phone: string | null }) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReservationSearchResult[] | null>(null);
  const [pending, startTransition] = useTransition();

  function runSearch() {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    startTransition(async () => {
      const r = await searchReservationCustomers(q);
      setResults(r);
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="고객명, 휴대폰 번호, 예약번호를 검색하세요"
            className="w-full rounded-xl border border-border bg-card py-3 pl-10 pr-3 text-[15px] outline-none focus:border-accent"
          />
        </div>
        <button
          type="button"
          onClick={runSearch}
          disabled={pending}
          className="shrink-0 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          검색
        </button>
      </div>

      {results === null && (
        <p className="py-10 text-center text-sm text-muted">
          고객명, 휴대폰 번호, 또는 예약번호로 검색해보세요.
        </p>
      )}

      {results !== null && results.length === 0 && (
        <p className="py-10 text-center text-sm text-muted">일치하는 고객이 없습니다.</p>
      )}

      {results !== null && results.length > 0 && (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={r.customer.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <Link
                  href={`/dashboard/customers/${r.customer.id}`}
                  className="text-[15px] font-bold text-foreground hover:underline"
                >
                  {r.customer.name}
                </Link>
                <span className="text-sm text-muted">{maskPhone(r.customer.phone)}</span>
              </div>

              {r.todayReservation ? (
                <TodayReservationBlock
                  reservation={r.todayReservation}
                  onView={onViewReservation ? () => onViewReservation(r.todayReservation!) : undefined}
                />
              ) : (
                <NoReservationBlock
                  customer={r.customer}
                  recent={r.recentReservation}
                  onRegister={onRegisterCustomer ? () => onRegisterCustomer(r.customer) : undefined}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TodayReservationBlock({
  reservation,
  onView,
}: {
  reservation: ReservationWithRelations;
  onView?: () => void;
}) {
  const badge = getStatusBadge(reservation.status);
  return (
    <div className="mt-3 rounded-xl border border-status-mint-text/30 bg-status-mint-bg p-3.5">
      <p className="flex items-center gap-1.5 font-bold text-status-mint-text">✓ 오늘 예약이 있습니다</p>
      <p className="mt-1.5 text-sm font-semibold text-foreground">
        {format(new Date(reservation.start_time), "HH:mm")} ~ {format(new Date(reservation.end_time), "HH:mm")}
      </p>
      <p className="text-sm text-muted">
        {reservation.content || reservation.service?.name || "예약내용 미입력"}
        {reservation.staff ? ` · 담당자 ${reservation.staff.name}` : ""}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.bg} ${badge.text}`}>
          {badge.label}
        </span>
        <span className="text-xs text-muted">예약번호 {reservationCode(reservation.id)}</span>
      </div>
      {onView ? (
        <button
          type="button"
          onClick={onView}
          className="mt-3 w-full rounded-lg border border-border py-2 text-sm font-medium text-foreground transition-colors hover:bg-background"
        >
          예약 상세보기
        </button>
      ) : (
        <Link
          href={`/dashboard/reservations/${reservation.id}`}
          className="mt-3 block w-full rounded-lg border border-border py-2 text-center text-sm font-medium text-foreground transition-colors hover:bg-background"
        >
          예약 상세보기
        </Link>
      )}
    </div>
  );
}

function NoReservationBlock({
  customer,
  recent,
  onRegister,
}: {
  customer: { id: string; name: string; phone: string | null };
  recent: ReservationWithRelations | null;
  onRegister?: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-3.5">
      <p className="font-bold text-muted">오늘 예약이 없습니다</p>
      {recent ? (
        <p className="mt-1.5 text-sm text-muted">
          최근 예약: {format(new Date(recent.start_time), "yyyy.MM.dd (EEE) HH:mm", { locale: ko })}
          {recent.content || recent.service?.name ? ` · ${recent.content || recent.service?.name}` : ""}
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-muted">예약 이력이 없는 고객입니다.</p>
      )}
      {onRegister ? (
        <button
          type="button"
          onClick={onRegister}
          className="mt-3 w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          예약 등록
        </button>
      ) : (
        <Link
          href={`/dashboard/reservations?new=1&customerId=${customer.id}`}
          className="mt-3 block w-full rounded-lg bg-accent py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          예약 등록
        </Link>
      )}
    </div>
  );
}

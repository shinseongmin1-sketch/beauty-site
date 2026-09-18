"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { getStatusBadge } from "@/lib/status";
import { maskPhone, reservationCode } from "@/lib/phone";
import { layoutTimeBlocks } from "@/lib/reservation-layout";
import { IconSearch, IconPlusCircle } from "../icons";
import { Modal, SidePanel } from "../overlay";
import type { CustomerOption } from "../customer-combobox";
import { ReservationFormFields, type ReservationFormOptions } from "./reservation-form";
import { CustomerSearchPanel } from "./customer-search-panel";
import { QuickCategoryPanel } from "../quick-category-panel";
import { createReservation, updateReservation, updateReservationStatus } from "./actions";
import { addReservationGroup, deleteReservationGroup, updateReservationGroup } from "./groups/actions";
import { addReservationType, deleteReservationType, updateReservationType } from "./types/actions";
import { RESERVATION_STATUS_LABEL, type ReservationStatus, type ReservationWithRelations } from "@/lib/types";

const GRID_START_HOUR = 9;
const GRID_END_HOUR = 21;
const HOUR_HEIGHT = 64; // px

export function ReservationCalendarClient({
  reservations,
  selectedDate,
  options,
  initialOpenCreate,
  prefillCustomerId,
  initialEditId,
  initialStatusFilter,
  noShowCounts,
  error,
}: {
  reservations: ReservationWithRelations[];
  selectedDate: string;
  options: ReservationFormOptions;
  initialOpenCreate: boolean;
  prefillCustomerId?: string;
  initialEditId?: string;
  initialStatusFilter?: string;
  noShowCounts?: Record<string, number>;
  error?: string;
}) {
  const router = useRouter();

  const [groupFilter, setGroupFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter ?? "");

  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState<ReservationWithRelations | null>(null);
  const [createOpen, setCreateOpen] = useState(initialOpenCreate);
  const [createPrefill, setCreatePrefill] = useState<CustomerOption | null>(
    prefillCustomerId
      ? options.customers.find((c) => c.id === prefillCustomerId) ?? { id: prefillCustomerId, name: "", phone: null }
      : null
  );
  const [editing, setEditing] = useState<ReservationWithRelations | null>(
    () => (initialEditId ? reservations.find((r) => r.id === initialEditId) ?? null : null)
  );

  const filtered = useMemo(() => {
    return reservations.filter((r) => {
      if (groupFilter && r.group_id !== groupFilter) return false;
      if (typeFilter && r.reservation_type_id !== typeFilter) return false;
      if (staffFilter && r.staff_id !== staffFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
  }, [reservations, groupFilter, typeFilter, staffFilter, statusFilter]);

  const gridStartHour = Math.min(GRID_START_HOUR, ...filtered.map((r) => new Date(r.start_time).getHours()));
  const gridEndHour = Math.max(
    GRID_END_HOUR,
    ...filtered.map((r) => Math.ceil(new Date(r.end_time).getHours() + new Date(r.end_time).getMinutes() / 60))
  );
  const hours = Array.from({ length: gridEndHour - gridStartHour }, (_, i) => gridStartHour + i);

  const dayStart = new Date(`${selectedDate}T00:00:00`);
  const layouts = layoutTimeBlocks(
    filtered.map((r) => ({ id: r.id, start: new Date(r.start_time), end: new Date(r.end_time) })),
    dayStart,
    gridStartHour
  );
  const layoutById = new Map(layouts.map((l) => [l.id, l]));

  function closeCreate() {
    setCreateOpen(false);
    setCreatePrefill(null);
    if (window.location.search.includes("new=1")) {
      router.replace(`/dashboard/reservations?date=${selectedDate}`);
    }
  }

  function openCreate() {
    setCreatePrefill(null);
    setCreateOpen(true);
  }

  async function handleCancel(reservationId: string) {
    if (!window.confirm("이 예약을 취소할까요?")) return;
    await updateReservationStatus(reservationId, "cancelled");
    setDetail(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-[26px] font-bold text-foreground">예약관리</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            <IconSearch className="h-4 w-4" />
            예약고객 검색
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            <IconPlusCircle className="h-4 w-4" />
            예약 등록
          </button>
        </div>
      </div>

      <DateNav selectedDate={selectedDate} />

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
        <div className="space-y-5">
          <QuickCategoryPanel
            title="예약그룹"
            entityLabel="그룹"
            items={options.groups}
            selectedId={groupFilter}
            onSelect={setGroupFilter}
            addAction={addReservationGroup}
            updateAction={updateReservationGroup}
            deleteAction={deleteReservationGroup}
          />
          <QuickCategoryPanel
            title="예약타입"
            entityLabel="타입"
            withColor
            items={options.types}
            selectedId={typeFilter}
            onSelect={setTypeFilter}
            addAction={addReservationType}
            updateAction={updateReservationType}
            deleteAction={deleteReservationType}
          />
        </div>

        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
            <FilterSelect
              label="담당자 전체"
              value={staffFilter}
              onChange={setStaffFilter}
              options={options.staff.map((s) => ({ value: s.id, label: s.name }))}
            />
            <FilterSelect
              label="예약상태 전체"
              value={statusFilter}
              onChange={setStatusFilter}
              options={(Object.keys(RESERVATION_STATUS_LABEL) as ReservationStatus[]).map((s) => ({
                value: s,
                label: RESERVATION_STATUS_LABEL[s],
              }))}
            />
            <span className="ml-auto text-sm text-muted">오늘 예약 {filtered.length}건</span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="grid grid-cols-[64px_1fr]">
              <div className="border-r border-border">
                {hours.map((h) => (
                  <div key={h} style={{ height: HOUR_HEIGHT }} className="border-b border-border px-2 pt-1 text-right text-xs text-muted">
                    {String(h).padStart(2, "0")}:00
                  </div>
                ))}
              </div>

              <div className="relative">
                {hours.map((h) => (
                  <div key={h} style={{ height: HOUR_HEIGHT }} className="border-b border-border" />
                ))}

                {filtered.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
                    이 날짜에 등록된 예약이 없습니다.
                  </div>
                )}

                {filtered.map((r) => {
                  const l = layoutById.get(r.id);
                  if (!l) return null;
                  const pxPerMin = HOUR_HEIGHT / 60;
                  const top = l.topMinutes * pxPerMin;
                  const height = Math.max(l.durationMinutes * pxPerMin, 40);
                  const widthPct = 100 / l.laneCount;
                  const leftPct = l.lane * widthPct;
                  const badge = getStatusBadge(r.status);
                  const compact = height < 76;

                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setDetail(r)}
                      style={{
                        position: "absolute",
                        top,
                        height,
                        left: `calc(${leftPct}% + 4px)`,
                        width: `calc(${widthPct}% - 8px)`,
                      }}
                      className={`overflow-hidden rounded-lg border-l-4 ${badge.border} ${badge.bg} px-2.5 py-1.5 text-left transition-shadow hover:shadow-md`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-[13px] font-bold text-foreground">
                          {r.customer?.name ?? "고객 미지정"}
                        </p>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-muted">{maskPhone(r.customer?.phone)}</p>
                      {!compact && (
                        <>
                          <p className="truncate text-[11px] text-foreground">
                            {r.content || r.service?.name || "예약내용 없음"}
                            {r.reservation_type ? ` · ${r.reservation_type.name}` : ""}
                          </p>
                          <p className="truncate text-[11px] text-muted">
                            {format(new Date(r.start_time), "HH:mm")}~{format(new Date(r.end_time), "HH:mm")}
                            {r.staff ? ` · 담당 ${r.staff.name}` : ""}
                          </p>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 예약고객 검색 패널 */}
      <SidePanel open={searchOpen} onClose={() => setSearchOpen(false)} title="예약고객 검색" width="w-full sm:w-[440px]">
        <CustomerSearchPanel
          autoFocus
          onViewReservation={(res) => {
            setSearchOpen(false);
            setDetail(res);
          }}
          onRegisterCustomer={(customer) => {
            setSearchOpen(false);
            setCreatePrefill({ id: customer.id ?? "", name: customer.name, phone: customer.phone });
            setCreateOpen(true);
          }}
        />
      </SidePanel>

      {/* 예약 상세 패널 */}
      <SidePanel open={!!detail} onClose={() => setDetail(null)} title="예약 상세">
        {detail && (
          <ReservationDetail
            reservation={detail}
            onEdit={() => {
              setEditing(detail);
              setDetail(null);
            }}
            onCancel={() => handleCancel(detail.id)}
          />
        )}
      </SidePanel>

      {/* 예약 등록 모달 */}
      <Modal open={createOpen} onClose={closeCreate} title="예약 등록" maxWidth="max-w-xl">
        <form action={createReservation} className="space-y-5">
          <ReservationFormFields
            options={options}
            defaultDate={selectedDate}
            defaultStartTime="10:00"
            prefillCustomer={createPrefill}
            noShowCounts={noShowCounts}
          />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeCreate} className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background">
              예약취소
            </button>
            <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
              예약등록
            </button>
          </div>
        </form>
      </Modal>

      {/* 예약 수정 모달 */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="예약 수정" maxWidth="max-w-xl">
        {editing && (
          <form action={updateReservation.bind(null, editing.id)} className="space-y-5">
            <ReservationFormFields options={options} defaultDate={selectedDate} editing={editing} noShowCounts={noShowCounts} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background">
                취소
              </button>
              <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
                저장
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function DateNav({ selectedDate }: { selectedDate: string }) {
  const d = new Date(`${selectedDate}T00:00:00`);
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  const today = format(new Date(), "yyyy-MM-dd");

  const fmt = (x: Date) => format(x, "yyyy-MM-dd");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/dashboard/reservations?date=${today}`} className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-background">
        오늘
      </Link>
      <Link href={`/dashboard/reservations?date=${fmt(prev)}`} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card hover:bg-background">
        ‹
      </Link>
      <form method="get" className="contents">
        <input
          type="date"
          name="date"
          defaultValue={selectedDate}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-accent"
        />
      </form>
      <Link href={`/dashboard/reservations?date=${fmt(next)}`} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card hover:bg-background">
        ›
      </Link>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ReservationDetail({
  reservation,
  onEdit,
  onCancel,
}: {
  reservation: ReservationWithRelations;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const badge = getStatusBadge(reservation.status);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-lg font-bold text-foreground">{reservation.customer?.name ?? "고객 미지정"}</p>
        <p className="text-sm text-muted">{reservation.customer?.phone ?? "-"}</p>
      </div>

      <div className="space-y-2.5 rounded-2xl border border-border bg-background p-4 text-sm">
        <Row label="일시">
          {format(new Date(reservation.start_time), "yyyy.MM.dd HH:mm")} ~{" "}
          {format(new Date(reservation.end_time), "HH:mm")}
        </Row>
        <Row label="예약내용">{reservation.content || reservation.service?.name || "-"}</Row>
        <Row label="예약그룹">{reservation.group?.name ?? "-"}</Row>
        <Row label="예약타입">{reservation.reservation_type?.name ?? "-"}</Row>
        <Row label="담당자">{reservation.staff?.name ?? "-"}</Row>
        <Row label="예약번호">{reservationCode(reservation.id)}</Row>
        <Row label="상태">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.bg} ${badge.text}`}>{badge.label}</span>
        </Row>
        <Row label="메모">{reservation.memo || "-"}</Row>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onEdit} className="rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-background">
          예약 수정
        </button>
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
        <button type="button" onClick={onCancel} className="rounded-xl border border-red-200 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50">
          예약 취소
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1 text-foreground">{children}</span>
    </div>
  );
}

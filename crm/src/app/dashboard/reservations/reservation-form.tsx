"use client";

import { format } from "date-fns";
import { CustomerCombobox, type CustomerOption } from "../customer-combobox";
import { RESERVATION_STATUS_LABEL, type ReservationStatus, type ReservationWithRelations } from "@/lib/types";

export interface ReservationFormOptions {
  customers: CustomerOption[];
  staff: { id: string; name: string }[];
  services: { id: string; name: string; duration_minutes: number; price: number }[];
  groups: { id: string; name: string; description?: string | null; active?: boolean }[];
  types: { id: string; name: string; color: string; active?: boolean }[];
}

const STATUS_ORDER: ReservationStatus[] = ["pending", "confirmed", "completed", "cancelled", "no_show"];

export function ReservationFormFields({
  options,
  defaultDate,
  defaultStartTime,
  editing,
  prefillCustomer,
  noShowCounts,
}: {
  options: ReservationFormOptions;
  defaultDate: string;
  defaultStartTime?: string;
  editing?: ReservationWithRelations | null;
  prefillCustomer?: CustomerOption | null;
  noShowCounts?: Record<string, number>;
}) {
  const initialCustomer: CustomerOption | null = editing?.customer
    ? { id: editing.customer.id, name: editing.customer.name, phone: editing.customer.phone }
    : prefillCustomer ?? null;

  const selectableGroups = options.groups.filter((g) => g.active !== false || g.id === editing?.group_id);
  const selectableTypes = options.types.filter((t) => t.active !== false || t.id === editing?.reservation_type_id);

  return (
    <div className="space-y-4">
      <input type="hidden" name="date" value={defaultDate} />

      <div>
        <label className="mb-1 block text-sm font-medium">고객 검색</label>
        <CustomerCombobox customers={options.customers} initial={initialCustomer} noShowCounts={noShowCounts} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">예약 시작시간</label>
          <input
            type="time"
            name="start_time"
            required
            defaultValue={editing ? format(new Date(editing.start_time), "HH:mm") : defaultStartTime}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">예약 종료시간</label>
          <input
            type="time"
            name="end_time"
            defaultValue={editing ? format(new Date(editing.end_time), "HH:mm") : ""}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            placeholder="비우면 메뉴 소요시간 기준 자동 계산"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">예약그룹</label>
          <select
            name="group_id"
            defaultValue={editing?.group_id ?? ""}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">미지정</option>
            {selectableGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.active === false ? `(사용 안 함) ${g.name}` : g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">예약타입</label>
          <select
            name="reservation_type_id"
            defaultValue={editing?.reservation_type_id ?? ""}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">미지정</option>
            {selectableTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.active === false ? `(사용 안 함) ${t.name}` : t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">담당자</label>
          <select
            name="staff_id"
            defaultValue={editing?.staff_id ?? ""}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">미지정</option>
            {options.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">시술/메뉴 (선택)</label>
          <select
            name="service_id"
            defaultValue={editing?.service_id ?? ""}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">미지정</option>
            {options.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.duration_minutes}분
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">예약내용</label>
        <input
          name="content"
          defaultValue={editing?.content ?? ""}
          placeholder="예: 남성 커트, 젤네일"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">고객 메모</label>
        <textarea
          name="memo"
          rows={2}
          defaultValue={editing?.memo ?? ""}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">예약상태</label>
        <select
          name="status"
          defaultValue={editing?.status ?? "confirmed"}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {RESERVATION_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

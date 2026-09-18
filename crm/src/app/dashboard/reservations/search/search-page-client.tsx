"use client";

import { useState } from "react";
import { Modal } from "../../overlay";
import type { CustomerOption } from "../../customer-combobox";
import { CustomerSearchPanel } from "../customer-search-panel";
import { ReservationFormFields, type ReservationFormOptions } from "../reservation-form";
import { createReservation } from "../actions";
import { format } from "date-fns";

export function SearchPageClient({ options }: { options: ReservationFormOptions }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [prefill, setPrefill] = useState<CustomerOption | null>(null);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">예약고객 검색</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          고객이 매장에 방문했을 때 예약 여부를 빠르게 확인하세요.
        </p>
      </div>

      <CustomerSearchPanel
        autoFocus
        onRegisterCustomer={(customer) => {
          setPrefill({ id: customer.id ?? "", name: customer.name, phone: customer.phone });
          setCreateOpen(true);
        }}
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="예약 등록" maxWidth="max-w-xl">
        <form action={createReservation} className="space-y-5">
          <ReservationFormFields
            options={options}
            defaultDate={format(new Date(), "yyyy-MM-dd")}
            defaultStartTime="10:00"
            prefillCustomer={prefill}
          />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background">
              취소
            </button>
            <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
              예약등록
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

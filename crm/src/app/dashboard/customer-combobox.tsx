"use client";

import { useMemo, useState } from "react";

export interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
}

/**
 * 예약 등록/상담 등록에서 공통으로 쓰는 고객 검색 콤보박스.
 * 기존 고객을 고르면 customer_id가 채워지고, 목록에 없는 이름을 입력하면
 * 신규 고객으로 취급해 이름/연락처 입력칸을 보여준다.
 */
export function CustomerCombobox({
  customers,
  initial,
  noShowCounts,
  noShowThreshold = 2,
}: {
  customers: CustomerOption[];
  initial?: CustomerOption | null;
  /** 고객 id -> 최근 6개월 노쇼 횟수. 있으면 선택 시 경고를 보여준다. */
  noShowCounts?: Record<string, number>;
  noShowThreshold?: number;
}) {
  const [query, setQuery] = useState(initial ? `${initial.name} ${initial.phone ?? ""}`.trim() : "");
  const [selected, setSelected] = useState<CustomerOption | null>(initial ?? null);
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || selected) return [];
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q))
      .slice(0, 8);
  }, [query, customers, selected]);

  const showNewCustomerFields = query.trim().length > 0 && !selected;

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="고객명 또는 휴대폰 번호 검색"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
        <input type="hidden" name="customer_id" value={selected?.id ?? ""} />

        {open && matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSelected(c);
                  setQuery(`${c.name} ${c.phone ?? ""}`.trim());
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-background"
              >
                <span className="font-medium text-foreground">{c.name}</span>
                <span className="text-muted">{c.phone ?? "-"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && noShowCounts && (noShowCounts[selected.id] ?? 0) >= noShowThreshold && (
        <p className="rounded-lg bg-status-orange-bg px-3 py-2 text-xs font-medium text-status-orange-text">
          ⚠ 최근 노쇼 이력이 있습니다. 최근 6개월 노쇼 {noShowCounts[selected.id]}회
        </p>
      )}

      {showNewCustomerFields && (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-background p-3">
          <div className="col-span-2 text-xs text-muted">
            일치하는 고객이 없어요. 신규 고객으로 등록합니다.
          </div>
          <input
            name="new_customer_name"
            defaultValue={query}
            placeholder="이름"
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
          <input
            name="new_customer_phone"
            placeholder="휴대폰 번호"
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </div>
      )}
    </div>
  );
}

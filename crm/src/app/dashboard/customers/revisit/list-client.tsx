"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { format } from "date-fns";

export interface RevisitRow {
  customerId: string;
  name: string;
  lastVisitDate: string;
  daysSince: number;
  lastService: string;
  lastStaff: string;
}

const FILTERS = [
  { key: "all", label: "전체", min: 0 },
  { key: "30", label: "30일 이상", min: 30 },
  { key: "60", label: "60일 이상", min: 60 },
  { key: "90", label: "90일 이상", min: 90 },
] as const;

export function RevisitListClient({ rows }: { rows: RevisitRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  const filtered = useMemo(() => {
    const min = FILTERS.find((f) => f.key === filter)?.min ?? 0;
    return rows.filter((r) => r.daysSince >= min).sort((a, b) => b.daysSince - a.daysSince);
  }, [rows, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors ${
              filter === f.key
                ? "border-accent bg-accent text-white"
                : "border-border bg-card text-foreground hover:bg-background"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center text-sm text-muted">{filtered.length}명</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-3">고객명</th>
              <th className="p-3">마지막 방문</th>
              <th className="p-3">경과일</th>
              <th className="p-3">최근 서비스</th>
              <th className="p-3">담당자</th>
              <th className="p-3">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted">
                  해당하는 고객이 없습니다.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.customerId}>
                <td className="p-3">
                  <Link href={`/dashboard/customers/${r.customerId}`} className="font-medium text-foreground hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="p-3 text-muted">{format(new Date(r.lastVisitDate), "yyyy.MM.dd")}</td>
                <td className="p-3 font-semibold text-foreground">{r.daysSince}일</td>
                <td className="p-3 text-muted">{r.lastService}</td>
                <td className="p-3 text-muted">{r.lastStaff}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-3">
                    <Link href={`/dashboard/customers/${r.customerId}`} className="text-accent hover:underline">
                      고객상세
                    </Link>
                    <Link href={`/dashboard/reservations?new=1&customerId=${r.customerId}`} className="text-accent hover:underline">
                      예약등록
                    </Link>
                    <Link
                      href={`/dashboard/marketing?customerId=${r.customerId}&customerName=${encodeURIComponent(r.name)}`}
                      className="text-muted hover:underline"
                    >
                      문자보내기
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

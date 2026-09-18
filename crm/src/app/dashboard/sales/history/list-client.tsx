"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { PaymentWithRelations } from "@/lib/types";

export function SalesHistoryClient({
  payments,
  staff,
  methods,
}: {
  payments: PaymentWithRelations[];
  staff: { id: string; name: string }[];
  methods: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return payments.filter((p) => {
      if (q) {
        const name = p.customer?.name?.toLowerCase() ?? "";
        const phone = p.customer?.phone ?? "";
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      if (staffFilter && p.staff_id !== staffFilter) return false;
      if (methodFilter && p.method_id !== methodFilter) return false;
      const paidDate = (p.paid_at ?? p.created_at).slice(0, 10);
      if (from && paidDate < from) return false;
      if (to && paidDate > to) return false;
      return true;
    });
  }, [payments, query, staffFilter, methodFilter, from, to]);

  const total = filtered.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="고객명 / 연락처 검색"
          className="min-w-[180px] flex-1 rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border border-border px-3 py-2 text-sm" />
        <span className="text-muted">~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl border border-border px-3 py-2 text-sm" />
        <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="rounded-xl border border-border px-3 py-2 text-sm">
          <option value="">담당자 전체</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className="rounded-xl border border-border px-3 py-2 text-sm">
          <option value="">결제방법 전체</option>
          {methods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>{filtered.length}건</span>
        <span>
          합계 <strong className="text-foreground">{total.toLocaleString()}원</strong>
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-3">결제일</th>
              <th className="p-3">고객</th>
              <th className="p-3">서비스</th>
              <th className="p-3">담당자</th>
              <th className="p-3">결제방법</th>
              <th className="p-3">금액</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted">
                  매출 내역이 없습니다.
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr key={p.id}>
                <td className="p-3 text-muted">{format(new Date(p.paid_at ?? p.created_at), "yyyy.MM.dd")}</td>
                <td className="p-3">
                  {p.customer ? (
                    <Link href={`/dashboard/customers/${p.customer.id}`} className="font-medium text-foreground hover:underline">
                      {p.customer.name}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="p-3 text-muted">{p.service?.name ?? "-"}</td>
                <td className="p-3 text-muted">{p.staff?.name ?? "-"}</td>
                <td className="p-3 text-muted">{p.payment_method?.name ?? p.method ?? "미지정"}</td>
                <td className="p-3 font-medium text-foreground">
                  {p.amount.toLocaleString()}원
                  {p.discount_amount > 0 && <span className="ml-1 text-xs text-muted">(할인 {p.discount_amount.toLocaleString()})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

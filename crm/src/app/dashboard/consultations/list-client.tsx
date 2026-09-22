"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { getConsultationResultBadge } from "@/lib/status";
import { CONSULTATION_RESULTS, type ConsultationType, type ConsultationWithRelations } from "@/lib/types";
import { QuickCategoryPanel } from "../quick-category-panel";
import { updateConsultationResult } from "./actions";
import { addConsultationType, deleteConsultationType, updateConsultationType } from "./types/actions";

export function ConsultationListClient({
  consultations,
  staff,
  types,
  canManageCatalogs,
}: {
  consultations: ConsultationWithRelations[];
  staff: { id: string; name: string }[];
  types: ConsultationType[];
  canManageCatalogs: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [resultFilter, setResultFilter] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return consultations.filter((c) => {
      if (q) {
        const name = c.customer?.name?.toLowerCase() ?? "";
        const phone = c.customer?.phone ?? "";
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      if (typeFilter && c.type_id !== typeFilter) return false;
      if (staffFilter && c.staff_id !== staffFilter) return false;
      if (resultFilter && c.result !== resultFilter) return false;
      return true;
    });
  }, [consultations, query, typeFilter, staffFilter, resultFilter]);

  function handleResultChange(id: string, result: string) {
    startTransition(async () => {
      await updateConsultationResult(id, result);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold text-foreground">상담관리</h1>
          <p className="mt-1.5 text-[15px] text-muted">고객 상담 이력을 기록하고 관리하세요.</p>
        </div>
        <Link
          href="/dashboard/consultations/new"
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          + 상담 등록
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
        <QuickCategoryPanel
          title="상담유형"
          entityLabel="유형"
          items={types}
          selectedId={typeFilter}
          onSelect={setTypeFilter}
          addAction={addConsultationType}
          updateAction={updateConsultationType}
          deleteAction={deleteConsultationType}
          readOnly={!canManageCatalogs}
        />

        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="고객명 / 연락처 검색"
              className="min-w-[200px] flex-1 rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="rounded-xl border border-border px-3 py-2 text-sm">
              <option value="">담당자 전체</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} className="rounded-xl border border-border px-3 py-2 text-sm">
              <option value="">상담상태 전체</option>
              {CONSULTATION_RESULTS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-background text-muted">
                <tr>
                  <th className="p-4 font-medium">날짜</th>
                  <th className="p-4 font-medium">고객명</th>
                  <th className="p-4 font-medium">상담유형</th>
                  <th className="p-4 font-medium">상담내용</th>
                  <th className="p-4 font-medium">담당자</th>
                  <th className="p-4 font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted">
                      상담 이력이 없습니다.
                    </td>
                  </tr>
                )}
                {filtered.map((c) => {
                  const badge = getConsultationResultBadge(c.result);
                  return (
                    <tr key={c.id}>
                      <td className="p-4 text-muted">{format(new Date(`${c.consult_date}T00:00:00`), "yyyy.MM.dd")}</td>
                      <td className="p-4">
                        {c.customer ? (
                          <Link href={`/dashboard/customers/${c.customer.id}`} className="font-medium text-foreground hover:underline">
                            {c.customer.name}
                          </Link>
                        ) : (
                          "미지정"
                        )}
                      </td>
                      <td className="p-4 text-muted">{c.type_ref?.name ?? c.type ?? "미지정"}</td>
                      <td className="p-4 max-w-xs truncate text-foreground">{c.content || "-"}</td>
                      <td className="p-4 text-muted">{c.staff?.name ?? "-"}</td>
                      <td className="p-4">
                        <select
                          defaultValue={c.result}
                          onChange={(e) => handleResultChange(c.id, e.target.value)}
                          className={`rounded-full border-0 px-2.5 py-1 text-xs font-semibold outline-none ${badge.bg} ${badge.text}`}
                        >
                          {CONSULTATION_RESULTS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

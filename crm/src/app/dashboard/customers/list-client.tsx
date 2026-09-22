"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { maskPhone } from "@/lib/phone";
import { canAccess } from "@/lib/permissions";
import type { CustomerGrade, CustomerTag, CustomerWithMeta, StaffRole } from "@/lib/types";
import { exportCustomersCsv } from "./export-actions";
import { ImportCustomersModal } from "./import-modal";

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CustomerListClient({
  customers,
  grades,
  tags,
  role,
}: {
  customers: CustomerWithMeta[];
  grades: CustomerGrade[];
  tags: CustomerTag[];
  role: StaffRole;
}) {
  const [gradeFilter, setGradeFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [exportPending, startExport] = useTransition();
  const [exportError, setExportError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const canExport = canAccess(role, "dataExport");
  const canImport = canAccess(role, "dataImport");

  function handleExport() {
    setExportError(null);
    startExport(async () => {
      const result = await exportCustomersCsv({ gradeId: gradeFilter || null, tagId: tagFilter || null });
      if (result.ok) downloadCsv(result.csv, result.filename);
      else setExportError(result.error);
    });
  }

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (gradeFilter && c.grade_id !== gradeFilter) return false;
      if (tagFilter && !c.tags.some((t) => t.id === tagFilter)) return false;
      return true;
    });
  }, [customers, gradeFilter, tagFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="rounded-xl border border-border px-3 py-2 text-sm">
          <option value="">고객등급 전체</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="rounded-xl border border-border px-3 py-2 text-sm">
          <option value="">태그 전체</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-sm text-muted">총 {filtered.length}명</span>
        {canExport && (
          <button
            type="button"
            onClick={handleExport}
            disabled={exportPending}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-background disabled:opacity-60"
          >
            {exportPending ? "내보내는 중…" : "CSV 내보내기"}
          </button>
        )}
        {canImport && (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-background"
          >
            CSV 가져오기
          </button>
        )}
      </div>

      {exportError && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{exportError}</p>}
      {canImport && <ImportCustomersModal open={importOpen} onClose={() => setImportOpen(false)} />}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-3">이름</th>
              <th className="p-3">등급 / 태그</th>
              <th className="p-3">연락처</th>
              <th className="p-3">메모</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted">
                  등록된 고객이 없습니다.
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id}>
                <td className="p-3">
                  <Link href={`/dashboard/customers/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.grade && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                        {c.grade.name}
                      </span>
                    )}
                    {c.tags.map((t) => (
                      <span key={t.id} className="rounded-full bg-status-gray-bg px-2 py-0.5 text-xs text-status-gray-text">
                        {t.name}
                      </span>
                    ))}
                    {!c.grade && c.tags.length === 0 && <span className="text-muted">-</span>}
                  </div>
                </td>
                <td className="p-3">{maskPhone(c.phone)}</td>
                <td className="p-3 text-muted">{c.memo ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

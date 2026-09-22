"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../overlay";
import { commitCustomerImportCsv, validateCustomerImportCsv, type ImportPreviewResult } from "./import-actions";

/**
 * CSV 업로드 → 검증/미리보기 → 최종 확인 → 실제 반영.
 * 미리보기와 커밋 모두 같은 File 객체를 서버로 보내 서버가 매번 처음부터 다시 검증한다
 * (미리보기 응답을 조작해서 커밋에 밀어 넣는 경로 자체가 없음). 오류가 하나라도 있으면
 * "가져오기 확정" 버튼을 비활성화해, 부분적으로만 반영되는 상황을 만들지 않는다.
 */
export function ImportCustomersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [done, setDone] = useState<{ inserted: number; updated: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setFatalError(null);
    setDone(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setPreview(null);
    setFatalError(null);
    setDone(null);
    setFile(f);
    if (!f) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", f);
      const result = await validateCustomerImportCsv(formData);
      if (result.ok) setPreview(result);
      else setFatalError(result.error);
    });
  }

  function handleConfirm() {
    if (!file) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await commitCustomerImportCsv(formData);
      if (result.ok) {
        setDone({ inserted: result.inserted, updated: result.updated });
        setPreview(null);
        router.refresh();
      } else {
        setFatalError(result.error);
      }
    });
  }

  const errorRows = preview?.ok ? preview.rows.filter((r) => r.status === "error") : [];
  const sampleRows = preview?.ok ? preview.rows.filter((r) => r.status !== "error").slice(0, 20) : [];

  return (
    <Modal open={open} onClose={handleClose} title="고객 CSV 가져오기" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          이 프로그램에서 내보낸 CSV 형식(이름, 연락처, 메모, 고객등급, 고객태그)만 가져올 수 있습니다. 연락처가 같은
          기존 고객은 갱신되고, 비어 있는 셀은 기존 값을 바꾸지 않습니다. 최대 2MB, 2,000행까지 가능합니다.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          disabled={pending}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-background"
        />

        {pending && !preview && !fatalError && <p className="text-sm text-muted">확인하는 중…</p>}

        {fatalError && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{fatalError}</p>}

        {done && (
          <p className="rounded-lg bg-status-mint-bg px-4 py-3 text-sm text-status-mint-text">
            가져오기를 완료했습니다. 신규 {done.inserted}명, 업데이트 {done.updated}명.
          </p>
        )}

        {preview?.ok && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-xl border border-border p-3">
                <p className="text-muted">신규 등록</p>
                <p className="text-lg font-bold text-foreground">{preview.newCount}명</p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-muted">기존 고객 업데이트</p>
                <p className="text-lg font-bold text-foreground">{preview.updateCount}명</p>
              </div>
              <div className={`rounded-xl border p-3 ${preview.errorCount > 0 ? "border-red-200 bg-red-50" : "border-border"}`}>
                <p className={preview.errorCount > 0 ? "text-red-600" : "text-muted"}>오류</p>
                <p className={`text-lg font-bold ${preview.errorCount > 0 ? "text-red-600" : "text-foreground"}`}>{preview.errorCount}건</p>
              </div>
            </div>

            {errorRows.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-red-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-red-50 text-red-700">
                    <tr>
                      <th className="p-2">행</th>
                      <th className="p-2">이름</th>
                      <th className="p-2">오류</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {errorRows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="p-2 text-muted">{r.rowNumber}</td>
                        <td className="p-2">{r.name || "-"}</td>
                        <td className="p-2 text-red-600">{r.errors.join(" / ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.errorCount === 0 && sampleRows.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-background text-muted">
                    <tr>
                      <th className="p-2">행</th>
                      <th className="p-2">이름</th>
                      <th className="p-2">연락처</th>
                      <th className="p-2">구분</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sampleRows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="p-2 text-muted">{r.rowNumber}</td>
                        <td className="p-2">{r.name}</td>
                        <td className="p-2 text-muted">{r.phoneMasked ?? "-"}</td>
                        <td className="p-2">{r.status === "update" ? "기존 고객" : "신규"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.totalRows > sampleRows.length && (
                  <p className="p-2 text-center text-xs text-muted">외 {preview.totalRows - sampleRows.length}건</p>
                )}
              </div>
            )}

            {preview.errorCount > 0 && (
              <p className="text-xs text-muted">오류가 있는 행이 있어 가져오기를 진행할 수 없습니다. CSV를 수정한 뒤 파일을 다시 선택해주세요.</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={handleClose} className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background">
            닫기
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!preview?.ok || preview.errorCount > 0 || pending}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
          >
            가져오기 확정
          </button>
        </div>
      </div>
    </Modal>
  );
}

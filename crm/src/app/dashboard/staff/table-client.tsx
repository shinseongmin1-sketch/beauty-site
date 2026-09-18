"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal } from "../overlay";
import { STAFF_ROLE_LABEL, type Staff, type StaffRole } from "@/lib/types";
import { deleteStaff, toggleStaffActive, updateStaff } from "./actions";

const ROLES: StaffRole[] = ["owner", "manager", "staff"];

export function StaffTableClient({ staff }: { staff: Staff[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<Staff | null>(null);

  function handleToggle(id: string, active: boolean) {
    startTransition(async () => {
      await toggleStaffActive(id, active);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm("이 담당자를 삭제할까요?")) return;
    startTransition(async () => {
      await deleteStaff(id);
      router.refresh();
    });
  }

  function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await updateStaff(editing.id, formData);
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-3">이름</th>
              <th className="p-3">직책</th>
              <th className="p-3">연락처</th>
              <th className="p-3">권한</th>
              <th className="p-3">상태</th>
              <th className="p-3">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staff.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  등록된 담당자가 없습니다.
                </td>
              </tr>
            )}
            {staff.map((s) => (
              <tr key={s.id}>
                <td className="p-3">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </td>
                <td className="p-3 text-muted">{s.title ?? "-"}</td>
                <td className="p-3">{s.phone ?? "-"}</td>
                <td className="p-3">{STAFF_ROLE_LABEL[s.role]}</td>
                <td className="p-3">{s.active ? "근무중" : "비활성"}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={() => setEditing(s)} className="text-accent hover:underline">
                      수정
                    </button>
                    <button type="button" onClick={() => handleToggle(s.id, !s.active)} className="text-accent hover:underline">
                      {s.active ? "비활성화" : "활성화"}
                    </button>
                    <button type="button" onClick={() => handleDelete(s.id)} className="text-red-500 hover:underline">
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="담당자 수정">
        {editing && (
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">이름</label>
              <input name="name" required defaultValue={editing.name} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">전화번호</label>
              <input name="phone" defaultValue={editing.phone ?? ""} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">직책</label>
              <input
                name="title"
                defaultValue={editing.title ?? ""}
                placeholder="예: 네일 담당, 상담 담당"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">권한</label>
              <select name="role" defaultValue={editing.role} className="w-full rounded-lg border border-border px-3 py-2 text-sm">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {STAFF_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">색상</label>
              <input type="color" name="color" defaultValue={editing.color} className="h-10 w-20 rounded-lg border border-border" />
            </div>
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
    </>
  );
}

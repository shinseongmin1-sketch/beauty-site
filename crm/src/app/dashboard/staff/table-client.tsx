"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format } from "date-fns";
import { Modal } from "../overlay";
import { STAFF_ROLE_LABEL, type Staff, type StaffRole } from "@/lib/types";
import { deleteStaff, toggleStaffActive, updateStaff } from "./actions";
import { inviteStaff, revokeStaffInvitation, unlinkStaffAccount, type InviteResult } from "./invite-actions";

const ROLES: StaffRole[] = ["owner", "manager", "staff"];

export interface PendingInvite {
  email: string;
  expiresAt: string;
}

export function StaffTableClient({
  staff,
  pendingInvites,
  viewerRole,
}: {
  staff: Staff[];
  pendingInvites: Record<string, PendingInvite>;
  viewerRole: StaffRole;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Staff | null>(null);
  const [inviting, setInviting] = useState<Staff | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 관리자는 "직원" 직급 담당자의 계정만 초대·해제할 수 있다 (관리자 직급 계정은 대표 전용). DB 도 같은 규칙을 강제한다.
  const canManageAccount = (s: Staff) => s.role !== "owner" && (viewerRole === "owner" || s.role === "staff");

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

  function openInvite(s: Staff) {
    setInviting(s);
    setInviteEmail("");
    setInviteResult(null);
    setCopied(false);
  }

  function handleInviteSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!inviting) return;
    startTransition(async () => {
      setInviteResult(await inviteStaff(inviting.id, inviteEmail));
      router.refresh();
    });
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function handleRevoke(s: Staff) {
    if (!window.confirm(`${s.name}님에게 보낸 초대를 취소할까요? 이미 전달한 링크는 더 이상 사용할 수 없게 됩니다.`)) return;
    startTransition(async () => {
      const r = await revokeStaffInvitation(s.id);
      setNotice(r.ok ? "초대를 취소했습니다." : (r.error ?? "초대를 취소하지 못했습니다."));
      router.refresh();
    });
  }

  function handleUnlink(s: Staff) {
    if (
      !window.confirm(
        `${s.name}님의 로그인 계정 연결을 해제할까요?\n이 직원은 더 이상 로그인할 수 없고, 계정은 삭제됩니다. (예약·고객 등 기록은 그대로 남습니다.)`
      )
    )
      return;
    startTransition(async () => {
      const r = await unlinkStaffAccount(s.id);
      setNotice(r.ok ? "로그인 계정 연결을 해제했습니다." : (r.error ?? "연결을 해제하지 못했습니다."));
      router.refresh();
    });
  }

  return (
    <>
      {notice && (
        <p className="rounded-lg bg-status-mint-bg px-4 py-3 text-sm text-status-mint-text" role="status">
          {notice}
        </p>
      )}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-3">이름</th>
              <th className="p-3">직책</th>
              <th className="p-3">연락처</th>
              <th className="p-3">권한</th>
              <th className="p-3">로그인 계정</th>
              <th className="p-3">상태</th>
              <th className="p-3">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staff.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
                  등록된 담당자가 없습니다.
                </td>
              </tr>
            )}
            {staff.map((s) => {
              const invite = pendingInvites[s.id];
              return (
                <tr key={s.id}>
                  <td className="p-3">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    {s.name}
                  </td>
                  <td className="p-3 text-muted">{s.title ?? "-"}</td>
                  <td className="p-3">{s.phone ?? "-"}</td>
                  <td className="p-3">{STAFF_ROLE_LABEL[s.role]}</td>
                  <td className="p-3">
                    {s.role === "owner" ? (
                      <span className="text-muted">대표 계정</span>
                    ) : s.profile_id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-status-mint-bg px-2 py-0.5 text-xs font-semibold text-status-mint-text">
                          연결됨
                        </span>
                        {canManageAccount(s) && (
                          <button type="button" disabled={pending} onClick={() => handleUnlink(s)} className="text-red-500 hover:underline">
                            연결 해제
                          </button>
                        )}
                      </div>
                    ) : invite ? (
                      <div className="space-y-1">
                        <span className="rounded-full bg-status-gray-bg px-2 py-0.5 text-xs font-semibold text-status-gray-text">
                          초대 대기중
                        </span>
                        <p className="text-xs text-muted">
                          {invite.email} · {format(new Date(invite.expiresAt), "M월 d일")}까지
                        </p>
                        {canManageAccount(s) && (
                          <div className="flex gap-3 text-xs">
                            <button type="button" onClick={() => openInvite(s)} className="text-accent hover:underline">
                              다시 초대
                            </button>
                            <button type="button" disabled={pending} onClick={() => handleRevoke(s)} className="text-red-500 hover:underline">
                              초대 취소
                            </button>
                          </div>
                        )}
                      </div>
                    ) : canManageAccount(s) ? (
                      <button type="button" onClick={() => openInvite(s)} className="text-accent hover:underline">
                        계정 초대
                      </button>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="p-3">{s.active ? "근무중" : "비활성"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => setEditing(s)} className="text-accent hover:underline">
                        수정
                      </button>
                      <button type="button" onClick={() => handleToggle(s.id, !s.active)} className="text-accent hover:underline">
                        {s.active ? "비활성화" : "활성화"}
                      </button>
                      {!s.profile_id && s.role !== "owner" && (
                        <button type="button" onClick={() => handleDelete(s.id)} className="text-red-500 hover:underline">
                          삭제
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
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

      <Modal open={!!inviting} onClose={() => setInviting(null)} title={inviting ? `${inviting.name}님 로그인 계정 초대` : "계정 초대"}>
        {inviting && !inviteResult?.ok && (
          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <p className="text-sm text-muted">
              입력한 이메일로 가입할 수 있는 <b>초대 링크</b>가 만들어집니다. 링크를 직원에게 직접 전달해주세요 (카카오톡·문자 등).
              직원이 링크에서 비밀번호를 설정하면 {STAFF_ROLE_LABEL[inviting.role]} 권한으로 이 매장에만 로그인할 수 있어요.
            </p>
            {inviteResult && !inviteResult.ok && (
              <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{inviteResult.error}</p>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">직원 이메일</label>
              <input
                type="email"
                name="invite_email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="staff@example.com"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setInviting(null)} className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background">
                취소
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
              >
                초대 링크 만들기
              </button>
            </div>
          </form>
        )}
        {inviting && inviteResult?.ok && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              초대 링크가 만들어졌습니다. <b>{format(new Date(inviteResult.expiresAt), "M월 d일")}까지</b> 한 번만 사용할 수 있어요.
              이 창을 닫으면 링크를 다시 볼 수 없으니 지금 복사해서 전달해주세요 (필요하면 다시 초대할 수 있습니다).
            </p>
            <input
              readOnly
              value={inviteResult.link}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="초대 링크"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => copyLink(inviteResult.link)} className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background">
                {copied ? "복사됨" : "링크 복사"}
              </button>
              <button type="button" onClick={() => setInviting(null)} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
                닫기
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

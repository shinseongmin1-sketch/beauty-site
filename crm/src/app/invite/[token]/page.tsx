import { createAdminClient } from "@/lib/supabase/server";
import { hashInviteToken } from "@/lib/invitations";
import { STAFF_ROLE_LABEL, type StaffRole } from "@/lib/types";
import { acceptInvitation } from "./actions";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  let invitation: { business_name: string; email: string; role: StaffRole; staff_name: string } | null = null;
  try {
    const admin = await createAdminClient();
    const { data } = await admin.rpc("lookup_staff_invitation", { p_token_hash: hashInviteToken(token) });
    invitation = Array.isArray(data) && data[0] ? data[0] : null;
  } catch (e) {
    console.error("[invite] page lookup failed", e instanceof Error ? e.message : e);
  }

  if (!invitation) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold">초대 링크를 사용할 수 없습니다</h1>
          <p className="text-sm text-muted">
            링크가 만료되었거나, 이미 사용되었거나, 취소되었습니다. 초대해주신 대표님께 새 초대 링크를 요청해주세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            <span className="text-navy">{invitation.business_name}</span>
          </h1>
          <p className="mt-2 text-sm text-muted">
            {STAFF_ROLE_LABEL[invitation.role]} 계정으로 초대되었습니다. 이름과 비밀번호를 설정하면 바로 시작할 수 있어요.
          </p>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

        <form action={acceptInvitation.bind(null, token)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">이메일 (초대된 주소)</label>
            <input
              type="email"
              value={invitation.email}
              readOnly
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-muted outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">이름</label>
            <input
              type="text"
              name="full_name"
              required
              defaultValue={invitation.staff_name}
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">비밀번호</label>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
              placeholder="8자 이상"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">비밀번호 확인</label>
            <input
              type="password"
              name="password_confirm"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent py-2.5 font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            계정 만들고 시작하기
          </button>
        </form>
      </div>
    </div>
  );
}

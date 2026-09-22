"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { generateInviteToken, inviteErrorMessage } from "@/lib/invitations";

// 직원 로그인 계정 초대 / 취소 / 연결 해제.
// 모든 함수는 (1) 서버에서 로그인·사업장·직급을 확인하고 (2) DB 함수가 다시 한 번
// "같은 사업장인지 / 대표·관리자인지 / 관리자는 직원급만"을 검사한다.

export type InviteResult =
  | { ok: true; link: string; expiresAt: string }
  | { ok: false; error: string };

async function appBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function inviteStaff(staffId: string, email: string): Promise<InviteResult> {
  const { supabase, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "staffAdmin");
  requireWritable(subscription);

  const { token, hash } = generateInviteToken();
  const { error } = await supabase.rpc("create_staff_invitation", {
    p_staff_id: staffId,
    p_email: email,
    p_token_hash: hash,
  });

  if (error) {
    console.error("[staff-invite] create failed", { code: error.code, message: error.message });
    return { ok: false, error: inviteErrorMessage(error) };
  }

  revalidatePath("/dashboard/staff");
  return {
    ok: true,
    link: `${await appBaseUrl()}/invite/${token}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  };
}

export async function revokeStaffInvitation(staffId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase, profile } = await requireBusinessContext();
  requireAccess(profile.role, "staffAdmin");

  const { error } = await supabase.rpc("revoke_staff_invitation", { p_staff_id: staffId });
  if (error) {
    console.error("[staff-invite] revoke failed", { code: error.code, message: error.message });
    return { ok: false, error: inviteErrorMessage(error) };
  }
  revalidatePath("/dashboard/staff");
  return { ok: true };
}

/**
 * 직원 로그인 계정 연결 해제: 프로필의 사업장 접근을 끊고, 초대로 만들어진 로그인 계정을 삭제한다.
 * (계정이 남아 있으면 같은 이메일로 다시 초대할 수 없고, 사업장 없는 계정이 온보딩으로 들어가 별도 사업장을 만들 수 있다.)
 */
export async function unlinkStaffAccount(staffId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase, profile } = await requireBusinessContext();
  requireAccess(profile.role, "staffAdmin");

  const { data: profileId, error } = await supabase.rpc("unlink_staff_account", { p_staff_id: staffId });
  if (error || !profileId) {
    if (error) console.error("[staff-invite] unlink failed", { code: error.code, message: error.message });
    return { ok: false, error: inviteErrorMessage(error) };
  }

  try {
    const admin = await createAdminClient();
    const { error: delError } = await admin.auth.admin.deleteUser(profileId as string);
    if (delError) console.error("[staff-invite] delete user failed", { message: delError.message });
  } catch (e) {
    console.error("[staff-invite] delete user threw", e instanceof Error ? e.message : e);
  }

  revalidatePath("/dashboard/staff");
  return { ok: true };
}

"use server";

import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { hashInviteToken } from "@/lib/invitations";

const back = (token: string, message: string): never =>
  redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(message)}`);

/**
 * 초대 수락: 이름/비밀번호를 받아 로그인 계정을 만들고 초대된 사업장·직급에 연결한 뒤 로그인시킨다.
 * 이메일·사업장·직급은 초대에 저장된 값으로 고정되며 요청 값으로 바꿀 수 없다.
 * 계정 생성과 연결은 서버(service_role)에서만 일어난다.
 */
export async function acceptInvitation(token: string, formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("password_confirm") ?? "");

  if (!fullName) back(token, "이름을 입력해주세요.");
  if (password.length < 8) back(token, "비밀번호는 8자 이상이어야 합니다.");
  if (password !== passwordConfirm) back(token, "비밀번호가 서로 다릅니다.");

  const admin = await createAdminClient();
  const hash = hashInviteToken(token);

  const { data: found, error: lookupError } = await admin.rpc("lookup_staff_invitation", { p_token_hash: hash });
  const invitation = Array.isArray(found) ? found[0] : null;
  if (lookupError || !invitation) {
    if (lookupError) console.error("[invite] lookup failed", { code: lookupError.code, message: lookupError.message });
    back(token, "초대 링크가 만료되었거나 이미 사용되었습니다. 대표님께 새 초대를 요청해주세요.");
  }

  const email = invitation!.email as string;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created?.user) {
    console.error("[invite] create user failed", { status: createError?.status, message: createError?.message });
    back(token, "계정을 만들지 못했습니다. 이미 가입된 이메일이거나 비밀번호가 허용되지 않는 형식일 수 있습니다.");
  }

  const { error: finalizeError } = await admin.rpc("finalize_staff_invitation", {
    p_token_hash: hash,
    p_user_id: created!.user!.id,
  });
  if (finalizeError) {
    // 연결에 실패하면 방금 만든 계정을 지워서 "사업장 없는 계정"이 남지 않게 한다.
    console.error("[invite] finalize failed", { code: finalizeError.code, message: finalizeError.message });
    await admin.auth.admin.deleteUser(created!.user!.id).catch(() => {});
    back(token, "초대를 처리하지 못했습니다. 대표님께 새 초대를 요청해주세요.");
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    redirect(`/login?message=${encodeURIComponent("계정이 만들어졌습니다. 방금 설정한 이메일과 비밀번호로 로그인해주세요.")}`);
  }

  redirect("/dashboard");
}

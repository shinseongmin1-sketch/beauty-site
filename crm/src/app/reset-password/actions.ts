"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clearRecoveryCookie, hasValidRecoveryCookie } from "@/lib/recovery";

const back = (message: string): never =>
  redirect(`/reset-password?error=${encodeURIComponent(message)}`);

/**
 * 재설정 링크(/auth/confirm, /auth/callback)로 확립된 recovery 세션으로 비밀번호를 변경한다.
 * 로그인 세션 + recovery 표시 쿠키가 둘 다 있어야 하며, 변경 후에는 쿠키를 지우고 로그아웃시켜
 * 새 비밀번호로 다시 로그인하게 한다. 비밀번호 값은 어디에도 기록하지 않는다.
 */
export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("password_confirm") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await hasValidRecoveryCookie(user.id))) {
    redirect("/forgot-password?error=expired");
  }

  if (password.length < 8) back("비밀번호는 8자 이상이어야 합니다.");
  if (password !== passwordConfirm) back("비밀번호가 서로 다릅니다.");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("[reset-password] updateUser failed", error.code);
    if (error.code === "same_password") back("기존과 다른 새 비밀번호를 입력해주세요.");
    if (error.code === "weak_password") back("더 안전한 비밀번호를 입력해주세요.");
    back("비밀번호를 변경하지 못했습니다. 다시 시도해주세요.");
  }

  await clearRecoveryCookie();
  await supabase.auth.signOut();
  redirect(`/login?message=${encodeURIComponent("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.")}`);
}

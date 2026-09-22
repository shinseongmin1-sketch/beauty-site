"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signUpErrorMessage } from "@/lib/auth-errors";
import { logAudit, safeErrorCode } from "@/lib/audit";

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!email || !password || password.length < 6) {
    redirect(
      `/signup?error=${encodeURIComponent("이메일과 6자 이상의 비밀번호를 입력해주세요.")}`
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    // 영문 원문은 서버 로그에만 남기고, 화면에는 한국어 안내만 보여준다.
    console.error("[signup] failed", { code: error.code, status: error.status, message: error.message });
    await logAudit({
      actorType: "system",
      action: "auth.signup",
      resourceType: "auth",
      result: "failure",
      metadata: { error_code: safeErrorCode(error.code) },
    });
    redirect(`/signup?error=${encodeURIComponent(signUpErrorMessage(error))}`);
  }

  await logAudit({
    actorUserId: data.user?.id ?? null,
    actorType: "owner",
    action: "auth.signup",
    resourceType: "auth",
    result: "success",
  });

  // Supabase 프로젝트에서 이메일 확인(email confirmation)을 켜둔 경우
  // 세션이 바로 생기지 않는다. 그 경우 안내 후 로그인 페이지로 보낸다.
  if (!data.session) {
    redirect(
      `/login?message=${encodeURIComponent(
        "가입 확인 이메일을 보냈습니다. 메일함을 확인한 뒤 로그인해주세요."
      )}`
    );
  }

  redirect("/onboarding");
}

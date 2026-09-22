"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { actorTypeFromRole, logAudit, safeErrorCode } from "@/lib/audit";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("이메일과 비밀번호를 입력해주세요.")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    // 로그인 실패도 기록한다. 누구의 시도인지(이메일)는 개인정보라 남기지 않고, 원인 코드만 남긴다.
    await logAudit({
      actorType: "system",
      action: "auth.login",
      resourceType: "auth",
      result: "failure",
      metadata: { reason: safeErrorCode(error?.code) },
    });
    redirect(`/login?error=${encodeURIComponent("이메일 또는 비밀번호가 올바르지 않습니다.")}`);
  }

  const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, business_id")
    .eq("id", data.user.id)
    .maybeSingle();

  await logAudit({
    businessId: profile?.business_id ?? null,
    actorUserId: data.user.id,
    actorType: isPlatformAdmin === true ? "platform_admin" : actorTypeFromRole(profile?.role),
    action: "auth.login",
    resourceType: "auth",
    result: "success",
  });

  // 운영자 계정은 기본적으로 운영자 화면으로 보낸다 (일반 매장 화면과 분리)
  if (isPlatformAdmin === true && (next === "/dashboard" || !next.startsWith("/"))) {
    redirect("/admin");
  }
  redirect(next.startsWith("/") ? next : "/dashboard");
}

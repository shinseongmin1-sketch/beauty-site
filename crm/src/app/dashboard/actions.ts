"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { actorTypeFromRole, logAudit } from "@/lib/audit";

export async function signOut() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");
    const { data: profile } = await supabase.from("profiles").select("role, business_id").eq("id", user.id).maybeSingle();
    await logAudit({
      businessId: profile?.business_id ?? null,
      actorUserId: user.id,
      actorType: isPlatformAdmin === true ? "platform_admin" : actorTypeFromRole(profile?.role),
      action: "auth.logout",
      resourceType: "auth",
      result: "success",
    });
  }

  // 일반 로그아웃은 "이 기기(브라우저/프로그램)"의 세션만 끝낸다. 기본값(global)은 PC 에서 로그아웃하면
  // 휴대폰·태블릿 등 다른 기기까지 모두 로그아웃시키므로 쓰지 않는다.
  // (비밀번호 재설정 후 로그아웃은 reset-password/actions.ts 에서 전체 세션 종료(global)를 유지한다)
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

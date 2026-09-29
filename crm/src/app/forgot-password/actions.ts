"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const RESET_REQUESTED_MESSAGE = "입력하신 이메일이 가입되어 있다면 재설정 링크를 보내드렸습니다.";

async function appBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * 비밀번호 재설정 이메일 발송.
 * 이메일 존재 여부를 외부에 노출하지 않기 위해, 실제 발송 성공/실패와 무관하게 항상 같은 메시지를 보여준다.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect("/forgot-password?error=required");
  }

  const supabase = await createClient();
  // 재설정 링크는 recovery 전용 경로(/auth/confirm)로 받는다. 기본 템플릿(PKCE)이면 여기에 ?code= 가 붙어 오고,
  // token_hash 템플릿이면 템플릿의 링크가 같은 경로로 바로 들어온다. (NEXT_PUBLIC_APP_URL 없으면 요청 호스트 기준)
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await appBaseUrl()}/auth/confirm?next=/reset-password`,
  });
  if (error) {
    console.error("[forgot-password] resetPasswordForEmail failed", error.code);
  }

  redirect(`/forgot-password?message=${encodeURIComponent(RESET_REQUESTED_MESSAGE)}`);
}

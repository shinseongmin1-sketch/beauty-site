// 비밀번호 재설정 링크 처리 (recovery 전용).
//  - 새 이메일 템플릿: /auth/confirm?token_hash=...&type=recovery&next=/reset-password  → verifyOtp
//  - 템플릿 변경 전(기본 템플릿 + PKCE): Supabase 가 /auth/confirm?next=/reset-password&code=... 로 보냄 → exchangeCodeForSession
// 어느 쪽이든 성공하면 기존 로그인 세션은 재설정 대상 계정의 세션으로 교체되고, recovery 표시 쿠키를 발급한 뒤
// /reset-password 로만 이동한다. token_hash / code 값은 로그에 남기지 않는다.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { issueRecoveryCookie, RECOVERY_NEXT_PATHS } from "@/lib/recovery";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/reset-password";
  const next = RECOVERY_NEXT_PATHS.has(nextParam) ? nextParam : "/reset-password";

  const fail = (reason: "expired" | "invalid") =>
    NextResponse.redirect(`${origin}/forgot-password?error=${reason}`);

  const supabase = await createClient();
  let userId: string | null = null;

  if (tokenHash) {
    // 이 경로는 비밀번호 재설정 전용이다. 다른 유형(가입 확인, 매직링크 등)의 토큰은 받지 않는다.
    if (type !== "recovery") return fail("invalid");
    const { data, error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error || !data.user) {
      console.error("[auth/confirm] verifyOtp failed", error?.code);
      return fail("expired");
    }
    userId = data.user.id;
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      console.error("[auth/confirm] exchangeCodeForSession failed", error?.code);
      return fail("expired");
    }
    userId = data.user.id;
  } else {
    return fail("invalid");
  }

  try {
    await issueRecoveryCookie(userId);
  } catch (e) {
    console.error("[auth/confirm] recovery cookie issue failed", e instanceof Error ? e.message : e);
    return fail("invalid");
  }
  return NextResponse.redirect(`${origin}${next}`);
}

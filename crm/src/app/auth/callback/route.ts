// Supabase Auth PKCE 콜백 (기존 방식 호환용). code를 세션으로 교환한 뒤 내부 경로로만 이동시킨다.
// next 파라미터는 화이트리스트에 있는 값만 허용해 오픈 리다이렉트를 막는다.
// 새 비밀번호 재설정 메일은 /auth/confirm 을 쓰지만, 이미 발송된 옛 링크(next=/reset-password)도 동작하도록
// 이 경우에만 최근 재설정 요청이 있었는지 확인하고 recovery 표시 쿠키를 발급한다.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { issueRecoveryCookie, RECOVERY_MAX_AGE_SEC } from "@/lib/recovery";

const SAFE_NEXT_PATHS = new Set(["/reset-password", "/dashboard"]);
// 재설정 메일 링크 유효시간(Supabase 기본 1시간)보다 약간 여유를 둔다.
const RECOVERY_REQUEST_WINDOW_MS = 60 * 60 * 1000 + RECOVERY_MAX_AGE_SEC * 1000;

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/dashboard";
  const next = SAFE_NEXT_PATHS.has(nextParam) ? nextParam : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      if (next === "/reset-password") {
        // 재설정 요청 이력이 최근에 있을 때만 recovery 로 인정한다 (다른 인증 흐름에서 next 만 바꿔 들어오는 경우 차단).
        const sentAt = data.user.recovery_sent_at ? Date.parse(data.user.recovery_sent_at) : NaN;
        if (!Number.isFinite(sentAt) || Date.now() - sentAt > RECOVERY_REQUEST_WINDOW_MS) {
          return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
        }
        try {
          await issueRecoveryCookie(data.user.id);
        } catch (e) {
          console.error("[auth/callback] recovery cookie issue failed", e instanceof Error ? e.message : e);
          return NextResponse.redirect(`${origin}/forgot-password?error=invalid`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth/callback] exchangeCodeForSession failed", error?.code);
  }

  if (next === "/reset-password") {
    return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
  }
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("링크가 만료되었거나 유효하지 않습니다. 다시 시도해주세요.")}`
  );
}

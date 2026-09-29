// Next.js 16부터 middleware.ts가 proxy.ts로 이름이 바뀌었다.
// 여기서 Supabase 세션을 갱신하고, 로그인이 필요한 구간을 보호한다.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password"];
// /auth/callback, /auth/confirm 도 일부러 PUBLIC_PATHS 에 넣지 않는다: 이미 로그인된 브라우저에서 재설정 링크를 누르면
// "로그인 상태면 /dashboard 로 보냄" 규칙에 걸려 code/token_hash 를 처리하기 전에 튕겨나가기 때문이다.
// 두 경로는 보호 구간(/dashboard, /admin)이 아니므로 목록에서 빼두면 로그인 여부와 무관하게 route handler 까지 도달한다.
// /reset-password 는 일부러 PUBLIC_PATHS 에 넣지 않는다: recovery 링크로 들어오면 user 가 존재하므로
// PUBLIC_PATHS 에 넣으면 아래 "로그인 상태면 /dashboard 로 보냄" 규칙에 걸려 튕겨나간다.
// /dashboard, /admin 로 시작하지 않아 위 로그인 필요 규칙에도 안 걸리므로, 목록에서 빼두면
// 로그인 여부와 무관하게 그대로 통과한다. 대신 페이지/서버 액션이 "세션 + recovery 표시 쿠키"를 직접 검사해,
// 재설정 링크를 거치지 않은 일반 로그인 세션은 /forgot-password 로 돌려보낸다 (src/lib/recovery.ts).

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 토큰이 만료 임박이면 여기서 갱신되고, 위 setAll을 통해 응답 쿠키에 반영된다.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && (pathname.startsWith("/dashboard") || pathname.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

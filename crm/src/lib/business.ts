import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Business, Profile } from "@/lib/types";

/**
 * dashboard 하위 서버 컴포넌트/액션에서 공통으로 쓰는 컨텍스트.
 * 로그인 안 되어 있으면 /login, 매장이 없으면 /onboarding으로 보낸다.
 *
 * layout.tsx와 각 page.tsx가 이 함수를 각자 호출하기 때문에, React의
 * cache()로 감싸서 같은 요청 안에서는 실제 DB 조회가 한 번만 일어나도록
 * 한다 (안 그러면 페이지 이동마다 인증/매장 조회가 중복으로 여러 번 실행돼
 * 체감 속도가 느려진다).
 */
export const requireBusinessContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // profile과 business를 한 번의 조회로 합쳐서 왕복 횟수를 줄인다.
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, business:businesses(*)")
    .eq("id", user.id)
    .maybeSingle<Profile & { business: Business | null }>();

  if (!profile?.business_id || !profile.business) {
    redirect("/onboarding");
  }

  const { business, ...profileFields } = profile;

  return { supabase, user, profile: profileFields as Profile, business: business as Business };
});

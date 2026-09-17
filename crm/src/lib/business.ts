import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Business, Profile } from "@/lib/types";

/**
 * dashboard 하위 서버 컴포넌트/액션에서 공통으로 쓰는 컨텍스트.
 * 로그인 안 되어 있으면 /login, 매장이 없으면 /onboarding으로 보낸다.
 */
export async function requireBusinessContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile?.business_id) {
    redirect("/onboarding");
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", profile.business_id)
    .single<Business>();

  if (!business) {
    redirect("/onboarding");
  }

  return { supabase, user, profile, business: business! };
}

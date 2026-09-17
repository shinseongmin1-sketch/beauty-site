"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createBusiness(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;

  if (!name) {
    redirect(`/onboarding?error=${encodeURIComponent("매장 이름을 입력해주세요.")}`);
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .insert({ owner_id: user.id, name, phone, address })
    .select("id")
    .single();

  if (businessError || !business) {
    redirect(
      `/onboarding?error=${encodeURIComponent(
        businessError?.message ?? "매장 생성에 실패했습니다."
      )}`
    );
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ business_id: business!.id, role: "owner" })
    .eq("id", user.id);

  if (profileError) {
    redirect(`/onboarding?error=${encodeURIComponent(profileError.message)}`);
  }

  // 매장 소유자는 스스로도 직원 명단에 올려둔다 (예약 담당자로 지정 가능하도록).
  await supabase.from("staff").insert({
    business_id: business!.id,
    profile_id: user.id,
    name: (user.user_metadata?.full_name as string | undefined) || "대표",
    role: "owner",
  });

  redirect("/dashboard");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashBusinessNumber, maskBusinessNumber, normalizeBusinessNumber } from "@/lib/business-number";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";

export async function updateBusiness(formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "settings");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const representativeName = String(formData.get("representative_name") ?? "").trim() || null;
  const rawBusinessNumber = String(formData.get("business_number") ?? "").trim();
  const naverBookingId = String(formData.get("naver_booking_id") ?? "").trim() || null;
  const tossClientKey = String(formData.get("toss_client_key") ?? "").trim() || null;

  if (!name) return;

  await supabase
    .from("businesses")
    .update({
      name,
      phone,
      address,
      representative_name: representativeName,
      naver_booking_id: naverBookingId,
      toss_client_key: tossClientKey,
    })
    .eq("id", business.id);

  // 사업자등록번호는 아직 등록되지 않은 사업장에서만, 한 번만 등록할 수 있다 (원문은 저장하지 않고 해시/마스킹만).
  if (rawBusinessNumber && !business.business_number_masked) {
    const digits = normalizeBusinessNumber(rawBusinessNumber);
    if (!digits) {
      redirect(`/dashboard/settings?error=${encodeURIComponent("사업자등록번호 10자리를 정확히 입력해주세요.")}`);
    }
    const { error } = await supabase.rpc("set_business_number", {
      p_hash: hashBusinessNumber(digits!),
      p_masked: maskBusinessNumber(digits!),
    });
    if (error) {
      console.error("[settings] set_business_number failed", { code: error.code, message: error.message });
      const message = error.message.includes("business_number_in_use")
        ? "이미 다른 사업장에서 사용 중인 사업자등록번호입니다."
        : "사업자등록번호를 등록하지 못했습니다. 잠시 후 다시 시도해주세요.";
      redirect(`/dashboard/settings?error=${encodeURIComponent(message)}`);
    }
  }

  revalidatePath("/dashboard/settings");
}

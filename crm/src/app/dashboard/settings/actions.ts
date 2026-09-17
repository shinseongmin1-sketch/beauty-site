"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";

export async function updateBusiness(formData: FormData) {
  const { supabase, business } = await requireBusinessContext();

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const naverBookingId = String(formData.get("naver_booking_id") ?? "").trim() || null;
  const tossClientKey = String(formData.get("toss_client_key") ?? "").trim() || null;

  if (!name) return;

  await supabase
    .from("businesses")
    .update({
      name,
      phone,
      address,
      naver_booking_id: naverBookingId,
      toss_client_key: tossClientKey,
    })
    .eq("id", business.id);

  revalidatePath("/dashboard/settings");
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";

export async function createMarketingDraft(formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "marketing");
  requireWritable(subscription);

  const targetDescription = String(formData.get("target_description") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const channel = String(formData.get("channel") ?? "sms");

  if (!targetDescription || !message) {
    redirect(`/dashboard/marketing?error=${encodeURIComponent("발송 대상과 메시지를 입력해주세요.")}`);
  }

  await supabase.from("marketing_messages").insert({
    business_id: business.id,
    target_description: targetDescription,
    message,
    channel,
    status: "draft",
  });

  revalidatePath("/dashboard/marketing");
  redirect("/dashboard/marketing?sent=1");
}

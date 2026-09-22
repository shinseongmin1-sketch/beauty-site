"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";

export async function addPaymentMethod(formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "sales");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await supabase.from("payment_methods").insert({ business_id: business.id, name });
  revalidatePath("/dashboard/sales/methods");
}

export async function updatePaymentMethod(methodId: string, formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "sales");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await supabase
    .from("payment_methods")
    .update({ name })
    .eq("id", methodId)
    .eq("business_id", business.id);
  revalidatePath("/dashboard/sales/methods");
}

export async function deletePaymentMethod(methodId: string) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "sales");
  requireWritable(subscription);

  await supabase.from("payment_methods").delete().eq("id", methodId).eq("business_id", business.id);
  revalidatePath("/dashboard/sales/methods");
}

export async function togglePaymentMethodActive(methodId: string, active: boolean) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "sales");
  requireWritable(subscription);

  await supabase
    .from("payment_methods")
    .update({ active })
    .eq("id", methodId)
    .eq("business_id", business.id);
  revalidatePath("/dashboard/sales/methods");
}

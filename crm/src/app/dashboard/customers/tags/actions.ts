"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";

export async function addCustomerTag(formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await supabase.from("customer_tags").insert({ business_id: business.id, name });
  revalidatePath("/dashboard/customers/tags");
}

export async function updateCustomerTag(tagId: string, formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await supabase.from("customer_tags").update({ name }).eq("id", tagId).eq("business_id", business.id);
  revalidatePath("/dashboard/customers/tags");
}

export async function deleteCustomerTag(tagId: string) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);
  await supabase.from("customer_tags").delete().eq("id", tagId).eq("business_id", business.id);
  revalidatePath("/dashboard/customers/tags");
}

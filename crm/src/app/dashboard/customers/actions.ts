"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";

export async function addCustomer(formData: FormData) {
  const { supabase, business, subscription } = await requireBusinessContext();
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!name) return;

  await supabase.from("customers").insert({ business_id: business.id, name, phone, memo });
  revalidatePath("/dashboard/customers");
}

export async function updateCustomerMemo(customerId: string, formData: FormData) {
  const { supabase, business, subscription } = await requireBusinessContext();
  requireWritable(subscription);
  const memo = String(formData.get("memo") ?? "").trim() || null;

  await supabase
    .from("customers")
    .update({ memo })
    .eq("id", customerId)
    .eq("business_id", business.id);

  revalidatePath(`/dashboard/customers/${customerId}`);
}

export async function updateCustomerMeta(customerId: string, formData: FormData) {
  const { supabase, business, subscription } = await requireBusinessContext();
  requireWritable(subscription);
  const gradeId = String(formData.get("grade_id") ?? "") || null;
  const tagIds = formData.getAll("tag_ids").map(String);

  await supabase
    .from("customers")
    .update({ grade_id: gradeId })
    .eq("id", customerId)
    .eq("business_id", business.id);

  await supabase.from("customer_tag_links").delete().eq("customer_id", customerId);

  if (tagIds.length > 0) {
    await supabase
      .from("customer_tag_links")
      .insert(tagIds.map((tagId) => ({ business_id: business.id, customer_id: customerId, tag_id: tagId })));
  }

  revalidatePath(`/dashboard/customers/${customerId}`);
  revalidatePath("/dashboard/customers");
}

export async function deleteCustomer(customerId: string) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "deleteRecords");
  requireWritable(subscription);

  await supabase.from("customers").delete().eq("id", customerId).eq("business_id", business.id);
  revalidatePath("/dashboard/customers");
}

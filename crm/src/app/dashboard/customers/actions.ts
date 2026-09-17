"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";

export async function addCustomer(formData: FormData) {
  const { supabase, business } = await requireBusinessContext();

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!name) return;

  await supabase.from("customers").insert({ business_id: business.id, name, phone, memo });
  revalidatePath("/dashboard/customers");
}

export async function updateCustomerMemo(customerId: string, formData: FormData) {
  const { supabase, business } = await requireBusinessContext();
  const memo = String(formData.get("memo") ?? "").trim() || null;

  await supabase
    .from("customers")
    .update({ memo })
    .eq("id", customerId)
    .eq("business_id", business.id);

  revalidatePath(`/dashboard/customers/${customerId}`);
}

export async function deleteCustomer(customerId: string) {
  const { supabase, business } = await requireBusinessContext();

  await supabase.from("customers").delete().eq("id", customerId).eq("business_id", business.id);
  revalidatePath("/dashboard/customers");
}

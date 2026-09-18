"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";

export async function addCustomerGrade(formData: FormData) {
  const { supabase, business } = await requireBusinessContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await supabase.from("customer_grades").insert({ business_id: business.id, name });
  revalidatePath("/dashboard/customers/grades");
}

export async function updateCustomerGrade(gradeId: string, formData: FormData) {
  const { supabase, business } = await requireBusinessContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await supabase.from("customer_grades").update({ name }).eq("id", gradeId).eq("business_id", business.id);
  revalidatePath("/dashboard/customers/grades");
}

export async function deleteCustomerGrade(gradeId: string) {
  const { supabase, business } = await requireBusinessContext();
  await supabase.from("customer_grades").delete().eq("id", gradeId).eq("business_id", business.id);
  revalidatePath("/dashboard/customers/grades");
}

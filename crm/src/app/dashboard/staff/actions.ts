"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";

export async function addStaff(formData: FormData) {
  const { supabase, business } = await requireBusinessContext();

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "staff") as "manager" | "staff";
  const color = String(formData.get("color") ?? "#c44dff");

  if (!name) return;

  await supabase.from("staff").insert({ business_id: business.id, name, phone, role, color });
  revalidatePath("/dashboard/staff");
}

export async function toggleStaffActive(staffId: string, active: boolean) {
  const { supabase, business } = await requireBusinessContext();

  await supabase
    .from("staff")
    .update({ active })
    .eq("id", staffId)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/staff");
}

export async function deleteStaff(staffId: string) {
  const { supabase, business } = await requireBusinessContext();

  await supabase.from("staff").delete().eq("id", staffId).eq("business_id", business.id);
  revalidatePath("/dashboard/staff");
}

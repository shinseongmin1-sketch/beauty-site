"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";

export async function addStaff(formData: FormData) {
  const { supabase, business } = await requireBusinessContext();

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "staff") as "owner" | "manager" | "staff";
  const color = String(formData.get("color") ?? "#c44dff");

  if (!name) return;

  await supabase.from("staff").insert({ business_id: business.id, name, phone, title, role, color });
  revalidatePath("/dashboard/staff");
}

export async function updateStaff(staffId: string, formData: FormData) {
  const { supabase, business } = await requireBusinessContext();

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "staff") as "owner" | "manager" | "staff";
  const color = String(formData.get("color") ?? "#c44dff");

  if (!name) return;

  const { data: staffRow } = await supabase
    .from("staff")
    .update({ name, phone, title, role, color })
    .eq("id", staffId)
    .eq("business_id", business.id)
    .select("profile_id")
    .maybeSingle();

  // 이 담당자가 로그인 계정과 연결돼 있다면, 실제 접근 권한도 함께 맞춰준다.
  if (staffRow?.profile_id) {
    await supabase.from("profiles").update({ role }).eq("id", staffRow.profile_id);
  }

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

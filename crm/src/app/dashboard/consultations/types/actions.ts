"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";

export async function addConsultationType(formData: FormData) {
  const { supabase, business } = await requireBusinessContext();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) return;

  await supabase.from("consultation_types").insert({ business_id: business.id, name, description });
  revalidatePath("/dashboard/consultations/types");
  revalidatePath("/dashboard/consultations");
}

export async function updateConsultationType(typeId: string, formData: FormData) {
  const { supabase, business } = await requireBusinessContext();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) return;

  await supabase
    .from("consultation_types")
    .update({ name, description })
    .eq("id", typeId)
    .eq("business_id", business.id);
  revalidatePath("/dashboard/consultations/types");
  revalidatePath("/dashboard/consultations");
}

export async function deleteConsultationType(typeId: string) {
  const { supabase, business } = await requireBusinessContext();
  await supabase.from("consultation_types").delete().eq("id", typeId).eq("business_id", business.id);
  revalidatePath("/dashboard/consultations/types");
  revalidatePath("/dashboard/consultations");
}

export async function toggleConsultationTypeActive(typeId: string, active: boolean) {
  const { supabase, business } = await requireBusinessContext();
  await supabase
    .from("consultation_types")
    .update({ active })
    .eq("id", typeId)
    .eq("business_id", business.id);
  revalidatePath("/dashboard/consultations/types");
  revalidatePath("/dashboard/consultations");
}

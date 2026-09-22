"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";

export async function addReservationType(formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "#3b73e8");
  if (!name) return;

  await supabase.from("reservation_types").insert({ business_id: business.id, name, description, color });
  revalidatePath("/dashboard/reservations/types");
  revalidatePath("/dashboard/reservations");
}

export async function updateReservationType(typeId: string, formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "#3b73e8");
  if (!name) return;

  await supabase
    .from("reservation_types")
    .update({ name, description, color })
    .eq("id", typeId)
    .eq("business_id", business.id);
  revalidatePath("/dashboard/reservations/types");
  revalidatePath("/dashboard/reservations");
}

export async function deleteReservationType(typeId: string) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  await supabase.from("reservation_types").delete().eq("id", typeId).eq("business_id", business.id);
  revalidatePath("/dashboard/reservations/types");
  revalidatePath("/dashboard/reservations");
}

export async function toggleReservationTypeActive(typeId: string, active: boolean) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  await supabase
    .from("reservation_types")
    .update({ active })
    .eq("id", typeId)
    .eq("business_id", business.id);
  revalidatePath("/dashboard/reservations/types");
  revalidatePath("/dashboard/reservations");
}

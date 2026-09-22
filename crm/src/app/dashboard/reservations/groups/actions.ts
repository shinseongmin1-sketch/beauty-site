"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";

export async function addReservationGroup(formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) return;

  await supabase.from("reservation_groups").insert({ business_id: business.id, name, description });
  revalidatePath("/dashboard/reservations/groups");
  revalidatePath("/dashboard/reservations");
}

export async function updateReservationGroup(groupId: string, formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) return;

  await supabase
    .from("reservation_groups")
    .update({ name, description })
    .eq("id", groupId)
    .eq("business_id", business.id);
  revalidatePath("/dashboard/reservations/groups");
  revalidatePath("/dashboard/reservations");
}

export async function deleteReservationGroup(groupId: string) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  await supabase.from("reservation_groups").delete().eq("id", groupId).eq("business_id", business.id);
  revalidatePath("/dashboard/reservations/groups");
  revalidatePath("/dashboard/reservations");
}

export async function toggleReservationGroupActive(groupId: string, active: boolean) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  await supabase
    .from("reservation_groups")
    .update({ active })
    .eq("id", groupId)
    .eq("business_id", business.id);
  revalidatePath("/dashboard/reservations/groups");
  revalidatePath("/dashboard/reservations");
}

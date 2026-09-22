"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";

export async function addService(formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  const duration = Number(formData.get("duration_minutes") ?? 60);
  const price = Number(formData.get("price") ?? 0);

  if (!name) return;

  await supabase.from("services").insert({
    business_id: business.id,
    name,
    duration_minutes: duration,
    price,
  });
  revalidatePath("/dashboard/services");
}

export async function toggleServiceActive(serviceId: string, active: boolean) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  await supabase
    .from("services")
    .update({ active })
    .eq("id", serviceId)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/services");
}

export async function deleteService(serviceId: string) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");
  requireWritable(subscription);

  await supabase.from("services").delete().eq("id", serviceId).eq("business_id", business.id);
  revalidatePath("/dashboard/services");
}

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { actorTypeFromRole, logAudit } from "@/lib/audit";

export async function signOut() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");
    const { data: profile } = await supabase.from("profiles").select("role, business_id").eq("id", user.id).maybeSingle();
    await logAudit({
      businessId: profile?.business_id ?? null,
      actorUserId: user.id,
      actorType: isPlatformAdmin === true ? "platform_admin" : actorTypeFromRole(profile?.role),
      action: "auth.logout",
      resourceType: "auth",
      result: "success",
    });
  }

  await supabase.auth.signOut();
  redirect("/login");
}

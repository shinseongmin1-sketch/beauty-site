"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";
import type { StaffRole } from "@/lib/types";

// 폼에서 넘어온 등급 값을 신뢰하지 않고 허용 값만 통과시킨다. owner 등급은 어떤 경로로도 부여할 수 없다.
function parseAssignableRole(value: FormDataEntryValue | null): Exclude<StaffRole, "owner"> {
  return value === "manager" ? "manager" : "staff";
}

export async function addStaff(formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "staffAdmin");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || null;
  const role = parseAssignableRole(formData.get("role"));
  const color = String(formData.get("color") ?? "#c44dff");

  if (!name) return;

  await supabase.from("staff").insert({ business_id: business.id, name, phone, title, role, color });
  revalidatePath("/dashboard/staff");
}

export async function updateStaff(staffId: string, formData: FormData) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "staffAdmin");
  requireWritable(subscription);

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || null;
  const requestedRole = String(formData.get("role") ?? "");
  const color = String(formData.get("color") ?? "#c44dff");

  if (!name) return;

  // 등급(role)은 이 update 에 포함하지 않는다. 등급 변경은 아래 DB 함수(대표 전용)로만 가능하다.
  const { data: current } = await supabase
    .from("staff")
    .update({ name, phone, title, color })
    .eq("id", staffId)
    .eq("business_id", business.id)
    .select("role")
    .maybeSingle();

  if (current && requestedRole && requestedRole !== current.role && requestedRole !== "owner") {
    const { error } = await supabase.rpc("set_member_role", {
      p_staff_id: staffId,
      p_role: parseAssignableRole(requestedRole),
    });
    if (error) {
      console.error("[staff] set_member_role failed", { code: error.code, message: error.message });
    }
  }

  revalidatePath("/dashboard/staff");
}

export async function toggleStaffActive(staffId: string, active: boolean) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "staffAdmin");
  requireWritable(subscription);

  await supabase
    .from("staff")
    .update({ active })
    .eq("id", staffId)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/staff");
}

export async function deleteStaff(staffId: string) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "staffAdmin");
  requireWritable(subscription);

  // 대표(owner) 본인의 담당자 행과, 로그인 계정이 연결된 담당자는 삭제할 수 없다 (먼저 "계정 연결 해제").
  await supabase
    .from("staff")
    .delete()
    .eq("id", staffId)
    .eq("business_id", business.id)
    .neq("role", "owner")
    .is("profile_id", null);
  revalidatePath("/dashboard/staff");
}

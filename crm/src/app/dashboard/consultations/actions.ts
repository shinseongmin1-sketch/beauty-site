"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";

export async function createConsultation(formData: FormData) {
  const { supabase, business } = await requireBusinessContext();

  let customerId = String(formData.get("customer_id") ?? "") || null;
  const newCustomerName = String(formData.get("new_customer_name") ?? "").trim();
  const newCustomerPhone = String(formData.get("new_customer_phone") ?? "").trim();

  const consultDate = String(formData.get("consult_date") ?? "");
  const typeId = String(formData.get("type_id") ?? "") || null;
  const staffId = String(formData.get("staff_id") ?? "") || null;
  const content = String(formData.get("content") ?? "").trim() || null;
  const result = String(formData.get("result") ?? "상담중");
  const nextConsultDate = String(formData.get("next_consult_date") ?? "") || null;
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!consultDate) {
    redirect(`/dashboard/consultations/new?error=${encodeURIComponent("상담일을 입력해주세요.")}`);
  }

  if (!customerId && newCustomerName) {
    const { data: newCustomer, error } = await supabase
      .from("customers")
      .insert({ business_id: business.id, name: newCustomerName, phone: newCustomerPhone || null })
      .select("id")
      .single();

    if (error || !newCustomer) {
      redirect(`/dashboard/consultations/new?error=${encodeURIComponent("고객 등록에 실패했습니다.")}`);
    }
    customerId = newCustomer!.id;
  }

  if (!customerId) {
    redirect(`/dashboard/consultations/new?error=${encodeURIComponent("고객을 선택하거나 입력해주세요.")}`);
  }

  const { error: insertError } = await supabase.from("consultations").insert({
    business_id: business.id,
    customer_id: customerId,
    staff_id: staffId,
    consult_date: consultDate,
    type_id: typeId,
    content,
    result,
    next_consult_date: nextConsultDate,
    memo,
  });

  if (insertError) {
    redirect(`/dashboard/consultations/new?error=${encodeURIComponent(insertError.message)}`);
  }

  revalidatePath("/dashboard/consultations");
  redirect("/dashboard/consultations");
}

export async function updateConsultationResult(consultationId: string, result: string) {
  const { supabase, business } = await requireBusinessContext();

  await supabase
    .from("consultations")
    .update({ result })
    .eq("id", consultationId)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/consultations");
}

export async function deleteConsultation(consultationId: string) {
  const { supabase, business } = await requireBusinessContext();

  await supabase.from("consultations").delete().eq("id", consultationId).eq("business_id", business.id);
  revalidatePath("/dashboard/consultations");
}

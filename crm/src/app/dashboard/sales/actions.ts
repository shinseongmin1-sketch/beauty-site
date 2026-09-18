"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";

export async function createSale(formData: FormData) {
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "sales");

  let customerId = String(formData.get("customer_id") ?? "") || null;
  const newCustomerName = String(formData.get("new_customer_name") ?? "").trim();
  const newCustomerPhone = String(formData.get("new_customer_phone") ?? "").trim();

  const serviceId = String(formData.get("service_id") ?? "") || null;
  const staffId = String(formData.get("staff_id") ?? "") || null;
  const grossAmount = Number(formData.get("gross_amount") ?? 0);
  const discountAmount = Number(formData.get("discount_amount") ?? 0);
  const methodId = String(formData.get("method_id") ?? "") || null;
  const paidAt = String(formData.get("paid_at") ?? "");
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!paidAt || grossAmount <= 0) {
    redirect(`/dashboard/sales/new?error=${encodeURIComponent("결제일과 결제금액을 확인해주세요.")}`);
  }

  if (!customerId && newCustomerName) {
    const { data: newCustomer, error } = await supabase
      .from("customers")
      .insert({ business_id: business.id, name: newCustomerName, phone: newCustomerPhone || null })
      .select("id")
      .single();

    if (error || !newCustomer) {
      redirect(`/dashboard/sales/new?error=${encodeURIComponent("고객 등록에 실패했습니다.")}`);
    }
    customerId = newCustomer!.id;
  }

  const finalAmount = Math.max(grossAmount - discountAmount, 0);

  const { error: insertError } = await supabase.from("payments").insert({
    business_id: business.id,
    customer_id: customerId,
    staff_id: staffId,
    service_id: serviceId,
    reservation_id: null,
    gross_amount: grossAmount,
    discount_amount: discountAmount,
    amount: finalAmount,
    method_id: methodId,
    status: "paid",
    paid_at: new Date(`${paidAt}T00:00:00`).toISOString(),
    memo,
  });

  if (insertError) {
    redirect(`/dashboard/sales/new?error=${encodeURIComponent(insertError.message)}`);
  }

  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard/sales/history");
  redirect("/dashboard/sales/history");
}

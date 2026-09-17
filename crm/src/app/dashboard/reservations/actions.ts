"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import type { ReservationStatus } from "@/lib/types";

export async function createReservation(formData: FormData) {
  const { supabase, business } = await requireBusinessContext();

  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const staffId = String(formData.get("staff_id") ?? "") || null;
  const serviceId = String(formData.get("service_id") ?? "") || null;
  const memo = String(formData.get("memo") ?? "").trim() || null;

  let customerId = String(formData.get("customer_id") ?? "") || null;
  const newCustomerName = String(formData.get("new_customer_name") ?? "").trim();
  const newCustomerPhone = String(formData.get("new_customer_phone") ?? "").trim();

  if (!date || !time) {
    redirect(
      `/dashboard/reservations/new?error=${encodeURIComponent("날짜와 시간을 입력해주세요.")}`
    );
  }

  // 목록에서 고르지 않고 이름을 직접 입력했으면 고객을 새로 만든다.
  if (!customerId && newCustomerName) {
    const { data: newCustomer, error } = await supabase
      .from("customers")
      .insert({ business_id: business.id, name: newCustomerName, phone: newCustomerPhone || null })
      .select("id")
      .single();

    if (error || !newCustomer) {
      redirect(
        `/dashboard/reservations/new?error=${encodeURIComponent("고객 등록에 실패했습니다.")}`
      );
    }
    customerId = newCustomer!.id;
  }

  const startTime = new Date(`${date}T${time}:00`);
  let durationMinutes = 60;

  if (serviceId) {
    const { data: service } = await supabase
      .from("services")
      .select("duration_minutes")
      .eq("id", serviceId)
      .single();
    if (service) durationMinutes = service.duration_minutes;
  }

  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

  const { error: insertError } = await supabase.from("reservations").insert({
    business_id: business.id,
    customer_id: customerId,
    staff_id: staffId,
    service_id: serviceId,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    memo,
    status: "pending",
    source: "internal",
  });

  if (insertError) {
    redirect(`/dashboard/reservations/new?error=${encodeURIComponent(insertError.message)}`);
  }

  revalidatePath("/dashboard/reservations");
  redirect(`/dashboard/reservations?date=${date}`);
}

export async function updateReservationStatus(reservationId: string, status: ReservationStatus) {
  const { supabase, business } = await requireBusinessContext();

  await supabase
    .from("reservations")
    .update({ status })
    .eq("id", reservationId)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);
}

export async function deleteReservation(reservationId: string) {
  const { supabase, business } = await requireBusinessContext();

  await supabase
    .from("reservations")
    .delete()
    .eq("id", reservationId)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/reservations");
  redirect("/dashboard/reservations");
}

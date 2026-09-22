"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { endOfDay, startOfDay } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";
import { reservationCode } from "@/lib/phone";
import type { ReservationStatus, ReservationWithRelations } from "@/lib/types";

const RESERVATION_SELECT =
  "*, customer:customers(id,name,phone), staff:staff(id,name,color), service:services(id,name,duration_minutes,price), group:reservation_groups(id,name), reservation_type:reservation_types(id,name,color)";

function readReservationFields(formData: FormData) {
  const date = String(formData.get("date") ?? "");
  const startTimeStr = String(formData.get("start_time") ?? formData.get("time") ?? "");
  const endTimeStr = String(formData.get("end_time") ?? "");
  const staffId = String(formData.get("staff_id") ?? "") || null;
  const serviceId = String(formData.get("service_id") ?? "") || null;
  const groupId = String(formData.get("group_id") ?? "") || null;
  const typeId = String(formData.get("reservation_type_id") ?? "") || null;
  const status = (String(formData.get("status") ?? "pending") || "pending") as ReservationStatus;
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const content = String(formData.get("content") ?? "").trim() || null;

  return { date, startTimeStr, endTimeStr, staffId, serviceId, groupId, typeId, status, memo, content };
}

export async function createReservation(formData: FormData) {
  const { supabase, business, subscription } = await requireBusinessContext();
  requireWritable(subscription);

  const { date, startTimeStr, endTimeStr, staffId, serviceId, groupId, typeId, status, memo, content } =
    readReservationFields(formData);

  let customerId = String(formData.get("customer_id") ?? "") || null;
  const newCustomerName = String(formData.get("new_customer_name") ?? "").trim();
  const newCustomerPhone = String(formData.get("new_customer_phone") ?? "").trim();

  if (!date || !startTimeStr) {
    redirect(`/dashboard/reservations?new=1&error=${encodeURIComponent("날짜와 시작 시간을 입력해주세요.")}`);
  }

  if (!customerId && newCustomerName) {
    const { data: newCustomer, error } = await supabase
      .from("customers")
      .insert({ business_id: business.id, name: newCustomerName, phone: newCustomerPhone || null })
      .select("id")
      .single();

    if (error || !newCustomer) {
      redirect(`/dashboard/reservations?new=1&error=${encodeURIComponent("고객 등록에 실패했습니다.")}`);
    }
    customerId = newCustomer!.id;
  }

  const startTime = new Date(`${date}T${startTimeStr}:00`);
  let endTime: Date;

  if (endTimeStr) {
    endTime = new Date(`${date}T${endTimeStr}:00`);
  } else {
    let durationMinutes = 60;
    if (serviceId) {
      const { data: service } = await supabase
        .from("services")
        .select("duration_minutes")
        .eq("id", serviceId)
        .single();
      if (service) durationMinutes = service.duration_minutes;
    }
    endTime = new Date(startTime.getTime() + durationMinutes * 60_000);
  }

  const { error: insertError } = await supabase.from("reservations").insert({
    business_id: business.id,
    customer_id: customerId,
    staff_id: staffId,
    service_id: serviceId,
    group_id: groupId,
    reservation_type_id: typeId,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    content,
    memo,
    status,
    source: "internal",
  });

  if (insertError) {
    redirect(`/dashboard/reservations?new=1&error=${encodeURIComponent(insertError.message)}`);
  }

  revalidatePath("/dashboard/reservations");
  redirect(`/dashboard/reservations?date=${date}`);
}

export async function updateReservation(reservationId: string, formData: FormData) {
  const { supabase, business, subscription } = await requireBusinessContext();
  requireWritable(subscription);

  const { date, startTimeStr, endTimeStr, staffId, serviceId, groupId, typeId, status, memo, content } =
    readReservationFields(formData);

  const customerId = String(formData.get("customer_id") ?? "") || null;

  if (!date || !startTimeStr || !endTimeStr) {
    redirect(
      `/dashboard/reservations/${reservationId}?error=${encodeURIComponent("날짜와 시간을 입력해주세요.")}`
    );
  }

  const startTime = new Date(`${date}T${startTimeStr}:00`);
  const endTime = new Date(`${date}T${endTimeStr}:00`);

  await supabase
    .from("reservations")
    .update({
      customer_id: customerId,
      staff_id: staffId,
      service_id: serviceId,
      group_id: groupId,
      reservation_type_id: typeId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      content,
      memo,
      status,
    })
    .eq("id", reservationId)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  redirect(`/dashboard/reservations?date=${date}`);
}

export async function updateReservationStatus(reservationId: string, status: ReservationStatus) {
  const { supabase, business, subscription } = await requireBusinessContext();
  requireWritable(subscription);

  await supabase
    .from("reservations")
    .update({ status })
    .eq("id", reservationId)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);
}

export async function deleteReservation(reservationId: string) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "deleteRecords");
  requireWritable(subscription);

  await supabase
    .from("reservations")
    .delete()
    .eq("id", reservationId)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/reservations");
  redirect("/dashboard/reservations");
}

export interface ReservationSearchResult {
  customer: { id: string; name: string; phone: string | null };
  todayReservation: ReservationWithRelations | null;
  recentReservation: ReservationWithRelations | null;
}

/**
 * "예약고객 검색"에서 쓰는 핵심 함수. 고객명/연락처/예약번호로 찾은 뒤,
 * 고객별로 "오늘 예약이 있는지"와 "최근 예약이 언제였는지"를 함께 계산해서 돌려준다.
 */
export async function searchReservationCustomers(rawQuery: string): Promise<ReservationSearchResult[]> {
  const { supabase, business } = await requireBusinessContext();
  const query = rawQuery.trim();
  if (!query) return [];

  const digits = query.replace(/[^0-9]/g, "");
  const isCodeLike = /^[0-9a-zA-Z]{4,8}$/.test(query.replace(/\s/g, ""));

  const orFilters = [`name.ilike.%${query}%`];
  if (digits.length >= 3) orFilters.push(`phone.ilike.%${digits}%`);

  const { data: matchedCustomers } = await supabase
    .from("customers")
    .select("id,name,phone")
    .eq("business_id", business.id)
    .or(orFilters.join(","))
    .limit(20);

  const customerMap = new Map<string, { id: string; name: string; phone: string | null }>();
  for (const c of matchedCustomers ?? []) customerMap.set(c.id, c);

  let codeMatchedReservations: ReservationWithRelations[] = [];
  if (isCodeLike) {
    const { data: recentReservations } = await supabase
      .from("reservations")
      .select(RESERVATION_SELECT)
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(300)
      .returns<ReservationWithRelations[]>();

    const upper = query.toUpperCase();
    codeMatchedReservations = (recentReservations ?? []).filter((r) =>
      reservationCode(r.id).startsWith(upper)
    );
    for (const r of codeMatchedReservations) {
      if (r.customer) customerMap.set(r.customer.id, r.customer);
    }
  }

  if (customerMap.size === 0) return [];

  const customerIds = Array.from(customerMap.keys());
  const now = new Date();
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = endOfDay(now).toISOString();

  const { data: allReservations } = await supabase
    .from("reservations")
    .select(RESERVATION_SELECT)
    .in("customer_id", customerIds)
    .order("start_time", { ascending: false })
    .returns<ReservationWithRelations[]>();

  const results: ReservationSearchResult[] = [];

  for (const id of customerIds) {
    const customer = customerMap.get(id)!;
    const reservations = (allReservations ?? []).filter((r) => r.customer_id === id);

    const today =
      reservations.find(
        (r) =>
          r.start_time >= dayStart &&
          r.start_time <= dayEnd &&
          r.status !== "cancelled" &&
          r.status !== "no_show"
      ) ?? null;

    const recent =
      reservations.find((r) => r.status !== "cancelled" && r.status !== "no_show") ??
      reservations[0] ??
      null;

    const codeMatch = codeMatchedReservations.find((r) => r.customer_id === id) ?? null;

    let todayReservation = today;
    let recentReservation = today ? null : recent;

    if (codeMatch) {
      if (codeMatch.start_time >= dayStart && codeMatch.start_time <= dayEnd) {
        todayReservation = codeMatch;
        recentReservation = null;
      } else {
        recentReservation = codeMatch;
      }
    }

    results.push({ customer, todayReservation, recentReservation });
  }

  // 오늘 예약이 있는 고객을 먼저 보여준다.
  results.sort((a, b) => Number(Boolean(b.todayReservation)) - Number(Boolean(a.todayReservation)));

  return results;
}

"use server";

import { requireBusinessContext } from "@/lib/business";
import { requireWritable } from "@/lib/subscription";
import { requireAccess } from "@/lib/permissions";
import { reservationPaymentConfig } from "@/lib/toss";

export async function createPaymentIntent(reservationId: string) {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  requireAccess(profile.role, "payments");
  requireWritable(subscription);

  const config = reservationPaymentConfig(business.toss_client_key);
  if (!config) {
    throw new Error("예약 결제를 사용할 수 없습니다. 결제 설정이 완료되지 않았습니다.");
  }

  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, service:services(name, price)")
    .eq("id", reservationId)
    .eq("business_id", business.id)
    .single();

  if (!reservation) {
    throw new Error("예약을 찾을 수 없습니다.");
  }

  const service = Array.isArray(reservation.service)
    ? reservation.service[0]
    : reservation.service;
  const orderName = service?.name ?? "예약 결제";

  const { data: existing } = await supabase
    .from("payments")
    .select("toss_order_id, amount, status")
    .eq("reservation_id", reservationId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (existing) {
    return {
      orderId: existing.toss_order_id as string,
      amount: existing.amount as number,
      orderName,
      clientKey: config.clientKey,
      testMode: config.testMode,
      alreadyPaid: existing.status === "paid",
    };
  }

  const amount = service?.price ?? 0;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("결제할 금액이 없습니다. 시술/메뉴의 가격을 확인해주세요.");
  }
  const orderId = `res_${reservationId.slice(0, 8)}_${Date.now()}`;

  const { error } = await supabase.from("payments").insert({
    business_id: business.id,
    reservation_id: reservationId,
    amount,
    gross_amount: amount,
    status: "ready",
    toss_order_id: orderId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    orderId,
    amount,
    orderName,
    clientKey: config.clientKey,
    testMode: config.testMode,
    alreadyPaid: false,
  };
}

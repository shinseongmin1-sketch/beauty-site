"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { isBillingCycle } from "@/lib/billing/plans";
import { billingClientKey } from "@/lib/billing/toss";
import { chargeManual, reconcilePendingManual } from "@/lib/billing/charge";
import { AUTO_RENEW_CONSENT_VERSION } from "@/lib/billing/consent";
import { createAdminClient } from "@/lib/supabase/server";
import { reconcilePendingWidget, subWidgetClientKey } from "@/lib/billing/widget";

/**
 * 결제수단 등록(토스 자동결제 인증창: 카드 또는 계좌 자동이체) 준비. 대표만.
 * 브라우저에는 client key 와 이 매장의 customerKey 만 준다 (빌링키/시크릿 키는 서버에만).
 */
export async function prepareCardRegistration(
  cycle: string,
  consent: boolean
): Promise<
  | { ok: true; clientKey: string; customerKey: string; customerEmail: string | null; customerName: string | null; consentVersion: string }
  | { ok: false; error: string }
> {
  const { supabase, user, profile, business } = await requireBusinessContext();
  if (profile.role !== "owner") return { ok: false, error: "대표 계정만 결제수단을 관리할 수 있습니다." };
  if (!isBillingCycle(cycle)) return { ok: false, error: "요금제를 선택해주세요." };
  // 자동결제 동의 없이는 카드 등록(자동결제 설정)을 시작하지 않는다. 동의 기록은 카드 연결이 성공할 때 서버가 저장한다.
  if (consent !== true) return { ok: false, error: "자동결제 안내에 동의해주세요." };
  const { data: customerKey, error } = await supabase.rpc("billing_customer_key");
  if (error || typeof customerKey !== "string") {
    console.error("[billing] customer key failed", error?.code);
    return { ok: false, error: "결제 준비에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }
  try {
    return {
      ok: true,
      clientKey: billingClientKey(),
      customerKey,
      customerEmail: user.email ?? null,
      customerName: business.name ?? null, // 계좌 자동이체 인증창에 표시
      consentVersion: AUTO_RENEW_CONSENT_VERSION,
    };
  } catch (e) {
    console.error("[billing] client key missing", e instanceof Error ? e.message : e);
    return { ok: false, error: "결제 설정이 완료되지 않았습니다. 고객센터에 문의해주세요." };
  }
}

const back = (q: string): never => redirect(`/dashboard/billing?${q}`);

/**
 * 차단(expired) 상태에서 등록된 카드로 직접 결제. 대표만.
 * 매장은 세션 기준, 금액·주문번호는 DB 함수가 정한다. 성공하면 결제 시각부터 새 이용기간이 시작되고 즉시 이용 가능.
 */
export async function payNow(formData: FormData) {
  const { business, profile, subscription } = await requireBusinessContext();
  if (profile.role !== "owner") back("error=forbidden");
  const cycle = String(formData.get("cycle") ?? "");
  if (!isBillingCycle(cycle)) back("error=invalid_cycle");
  if (formData.get("consent") !== "on") back("error=consent_required");
  if (subscription.writable) back("error=already_active");

  const result = await chargeManual(business.id, cycle, AUTO_RENEW_CONSENT_VERSION);
  revalidatePath("/dashboard", "layout");
  back(result);
}

/**
 * 자동결제 해지 (다음 자동결제만 중단). 대표만.
 * 매장 ID 를 받지 않는다: DB 함수가 로그인한 사용자의 매장·대표 권한을 직접 확인한다. 현재 이용기간은 그대로 유지된다.
 */
export async function cancelAutoRenewal() {
  const { supabase, profile } = await requireBusinessContext();
  if (profile.role !== "owner") back("error=forbidden");
  const { data, error } = await supabase.rpc("billing_cancel_auto_renewal");
  if (error) {
    const known = ["not_cancellable", "forbidden"].find((k) => error.message?.includes(k));
    if (!known) console.error("[billing] cancel failed", error.code);
    back(`error=${known ?? "cancel_failed"}`);
  }
  revalidatePath("/dashboard", "layout");
  back((data as { already_canceled?: boolean } | null)?.already_canceled ? "error=already_canceled" : "canceled=1");
}

/**
 * 구독 연장 = 자동결제 해지 취소. 대표만, 이용기간이 남은 해지 상태에서만 (DB 함수가 확인).
 * 지금 결제하지 않고, 원래 결제일에 등록된 결제수단으로 자동결제된다. 자동결제 동의를 다시 기록한다.
 */
export async function resumeAutoRenewal(formData: FormData) {
  const { supabase, profile } = await requireBusinessContext();
  if (profile.role !== "owner") back("error=forbidden");
  if (formData.get("consent") !== "on") back("error=consent_required");
  const { error } = await supabase.rpc("billing_resume_auto_renewal", { p_consent_version: AUTO_RENEW_CONSENT_VERSION });
  if (error) {
    const known = ["not_resumable", "payment_method_required", "forbidden"].find((k) => error.message?.includes(k));
    if (!known) console.error("[billing] resume failed", error.code);
    back(`error=${known ?? "resume_failed"}`);
  }
  revalidatePath("/dashboard", "layout");
  back("resumed=1");
}

/**
 * 직접 결제(토스 결제위젯, 1회 결제) 준비. 대표만.
 * 금액·주문번호·연장 기준 시각은 DB 함수(billing_start_widget)가 정한다. 브라우저에는 client key 와 주문 정보만 준다.
 * 시작 전에 이 매장의 끝나지 않은 직접 결제를 토스 주문 조회로 먼저 확정한다 (이미 결제됐는데 다시 결제하는 일 방지).
 */
export async function prepareWidgetPayment(
  cycle: string
): Promise<{ ok: true; clientKey: string; orderId: string; orderName: string; amount: number; customerName: string | null; customerEmail: string | null } | { ok: false; error: string }> {
  const { supabase, user, profile, business } = await requireBusinessContext();
  if (profile.role !== "owner") return { ok: false, error: "대표 계정만 결제할 수 있습니다." };
  if (!isBillingCycle(cycle)) return { ok: false, error: "요금제를 선택해주세요." };
  let clientKey: string;
  try {
    clientKey = subWidgetClientKey();
  } catch (e) {
    console.error("[billing] widget key missing", e instanceof Error ? e.message : e);
    return { ok: false, error: "결제 설정이 완료되지 않았습니다. 고객센터에 문의해주세요." };
  }
  const admin = await createAdminClient();
  const rec = await reconcilePendingWidget(admin, business.id);
  if (rec.waiting !== 0) return { ok: false, error: "확인 중인 결제가 있습니다. 잠시 후 다시 시도해주세요." };
  if (rec.resolved > 0) revalidatePath("/dashboard", "layout");

  const { data, error } = await supabase.rpc("billing_start_widget", { p_cycle: cycle });
  if (error || !data?.[0]) {
    const msg: Record<string, string> = {
      auto_renew_active: "자동결제가 켜져 있어 결제일에 자동으로 결제됩니다. 직접 결제하려면 먼저 자동결제를 해지해주세요.",
      too_early: "남은 이용기간이 31일 이내일 때부터 미리 결제할 수 있습니다.",
      payment_in_progress: "확인 중인 결제가 있습니다. 잠시 후 다시 시도해주세요.",
      suspended: "이용이 정지된 사업장입니다. 고객센터에 문의해주세요.",
      forbidden: "대표 계정만 결제할 수 있습니다.",
    };
    const known = Object.keys(msg).find((k) => error?.message?.includes(k));
    if (!known) console.error("[billing] start widget failed", error?.code);
    return { ok: false, error: known ? msg[known] : "결제 준비에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }
  const row = data[0] as { order_id: string; order_name: string; amount: number };
  return { ok: true, clientKey, orderId: row.order_id, orderName: row.order_name, amount: row.amount, customerName: business.name ?? null, customerEmail: user.email ?? null };
}

/** 결과를 모르는 직접 결제를 다시 확인 (대표 본인 매장만). 토스 주문번호 조회로 확정하며 새 결제는 만들지 않는다. */
export async function recheckPendingPayment() {
  const { business, profile } = await requireBusinessContext();
  if (profile.role !== "owner") back("error=forbidden");
  const admin = await createAdminClient();
  const r = await reconcilePendingManual(admin, business.id);
  const w = await reconcilePendingWidget(admin, business.id);
  revalidatePath("/dashboard", "layout");
  const { data: sub } = await admin.from("subscriptions").select("status").eq("business_id", business.id).maybeSingle();
  if (r.pending > 0 || w.waiting > 0) back("error=payment_pending");
  back(sub?.status === "active" ? "paid=1" : r.resolved + w.resolved > 0 ? "error=payment_failed" : "rechecked=1");
}

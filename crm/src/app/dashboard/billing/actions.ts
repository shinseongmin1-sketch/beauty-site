"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { isBillingCycle } from "@/lib/billing/plans";
import { billingClientKey } from "@/lib/billing/toss";
import { chargeManual } from "@/lib/billing/charge";

/**
 * 카드 등록(토스 자동결제 인증창) 준비. 대표만.
 * 브라우저에는 client key 와 이 매장의 customerKey 만 준다 (빌링키/시크릿 키는 서버에만).
 */
export async function prepareCardRegistration(
  cycle: string
): Promise<{ ok: true; clientKey: string; customerKey: string; customerEmail: string | null } | { ok: false; error: string }> {
  const { supabase, user, profile } = await requireBusinessContext();
  if (profile.role !== "owner") return { ok: false, error: "대표 계정만 결제수단을 관리할 수 있습니다." };
  if (!isBillingCycle(cycle)) return { ok: false, error: "요금제를 선택해주세요." };
  const { data: customerKey, error } = await supabase.rpc("billing_customer_key");
  if (error || typeof customerKey !== "string") {
    console.error("[billing] customer key failed", error?.code);
    return { ok: false, error: "결제 준비에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }
  try {
    return { ok: true, clientKey: billingClientKey(), customerKey, customerEmail: user.email ?? null };
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

  const result = await chargeManual(business.id, cycle);
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

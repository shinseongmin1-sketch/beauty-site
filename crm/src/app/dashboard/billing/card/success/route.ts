// 토스 자동결제 카드 등록 성공 콜백: ?customerKey=...&authKey=...&cycle=...&intent=register|pay
// 1) 세션의 매장/대표 확인 → 2) customerKey 가 이 매장에 발급한 값인지 확인 → 3) 서버가 토스에 빌링키 발급 요청
// → 4) 암호화해서 저장(이전 카드는 토스에서 삭제) → 5) intent=pay 이고 차단 상태면 곧바로 직접 결제.
// authKey/customerKey/빌링키는 로그에 남기지 않는다.
import { NextResponse, type NextRequest } from "next/server";
import { requireBusinessContext } from "@/lib/business";
import { createAdminClient } from "@/lib/supabase/server";
import { isBillingCycle } from "@/lib/billing/plans";
import { issueBillingKey, deleteBillingKey } from "@/lib/billing/toss";
import { encryptBillingKey, decryptBillingKey } from "@/lib/billing/crypto";
import { chargeManual } from "@/lib/billing/charge";
import { AUTO_RENEW_CONSENT_VERSION } from "@/lib/billing/consent";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(`${origin}/dashboard/billing?${q}`);

  const { supabase, business, profile, subscription } = await requireBusinessContext();
  if (profile.role !== "owner") return back("error=forbidden");

  const customerKey = searchParams.get("customerKey") ?? "";
  const authKey = searchParams.get("authKey") ?? "";
  const cycle = searchParams.get("cycle") ?? "";
  const intent = searchParams.get("intent") === "pay" ? "pay" : "register";
  if (!customerKey || !authKey || !isBillingCycle(cycle)) return back("error=invalid_request");
  // 자동결제 동의(현재 문구 버전)를 거쳐 온 요청만 받는다. 동의 기록은 카드 연결과 같은 트랜잭션에서 저장된다.
  if (searchParams.get("consent") !== AUTO_RENEW_CONSENT_VERSION) return back("error=consent_required");

  // 이 매장에 발급한 customerKey 인지 (다른 매장 키로 받은 인증을 끼워 넣는 것 차단). DB 함수도 한 번 더 확인한다.
  const { data: myKey } = await supabase.rpc("billing_customer_key");
  if (myKey !== customerKey) return back("error=customer_mismatch");

  let issued;
  try {
    issued = await issueBillingKey(authKey, customerKey);
  } catch (e) {
    console.error("[billing] issue failed", e instanceof Error ? e.message.split(":")[0] : e);
    return back("error=card_register_failed");
  }

  const admin = await createAdminClient();
  const { data: attached, error } = await admin.rpc("billing_attach_method", {
    p_business: business.id,
    p_customer_key: customerKey,
    p_billing_key_enc: encryptBillingKey(issued.billingKey),
    p_card_company: issued.cardCompany,
    p_card_number_masked: issued.cardNumberMasked,
    p_card_type: issued.cardType,
    p_billing_cycle: cycle,
    p_consent_version: AUTO_RENEW_CONSENT_VERSION,
  });
  if (error) {
    console.error("[billing] attach failed", error.code);
    await deleteBillingKey(issued.billingKey); // 저장하지 못한 빌링키는 남기지 않는다
    return back("error=card_register_failed");
  }
  const replaced = (attached as { replaced_billing_key_enc?: string | null } | null)?.replaced_billing_key_enc;
  if (replaced) {
    try {
      await deleteBillingKey(decryptBillingKey(replaced));
    } catch {
      console.error("[billing] old billing key delete skipped");
    }
  }

  if (intent === "pay" && !subscription.writable) {
    return back(await chargeManual(business.id, cycle, AUTO_RENEW_CONSENT_VERSION));
  }
  return back("registered=1");
}

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  hashBusinessNumber,
  hashPhone,
  maskBusinessNumber,
  normalizeBusinessNumber,
  normalizePhone,
} from "@/lib/business-number";

const back = (message: string): never => redirect(`/onboarding?error=${encodeURIComponent(message)}`);

export async function createBusiness(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  const representativeName = String(formData.get("representative_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;

  if (!name) back("매장 이름을 입력해주세요.");
  if (!representativeName) back("대표자명을 입력해주세요.");

  const businessNumber = normalizeBusinessNumber(String(formData.get("business_number") ?? ""));
  if (!businessNumber) back("사업자등록번호 10자리를 정확히 입력해주세요.");

  // 사업자번호/전화번호 원문은 DB 로 보내지 않는다: 서버에서 해시(중복 확인용)와 마스킹 표기만 만든다.
  // 무료체험 지급 여부는 DB 함수(create_my_business)가 이력(trial_history)을 보고 판단한다.
  let businessNumberHash: string;
  let phoneHash: string | null = null;
  try {
    businessNumberHash = hashBusinessNumber(businessNumber!);
    const phoneDigits = normalizePhone(phone);
    phoneHash = phoneDigits ? hashPhone(phoneDigits) : null;
  } catch (e) {
    console.error("[onboarding] identifier hashing failed", e instanceof Error ? e.message : e);
    return back("일시적인 오류로 매장을 만들지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  // 사업장 생성 / 내 프로필 연결 / 대표 직원 등록 / 기본 데이터 / 구독(무료체험) 을 DB 함수 하나가 한 트랜잭션으로 처리한다.
  const { error } = await supabase.rpc("create_my_business", {
    p_name: name,
    p_phone: phone,
    p_address: address,
    p_representative_name: representativeName,
    p_business_number_hash: businessNumberHash,
    p_business_number_masked: maskBusinessNumber(businessNumber!),
    p_phone_hash: phoneHash,
  });

  if (error) {
    // 이미 매장이 있는 계정이 다시 온보딩을 제출한 경우는 오류가 아니라 정상 진입으로 취급한다.
    if (error.code === "23505") {
      redirect("/dashboard");
    }
    console.error("[onboarding] create_my_business failed", { code: error.code, message: error.message });
    return back("매장 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }

  redirect("/dashboard");
}

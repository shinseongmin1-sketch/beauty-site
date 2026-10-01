// 결제 키 사용 규칙 (서버 전용). 예약결제(lib/toss.ts)와 구독 자동결제(lib/billing/toss.ts)가 함께 쓴다.
//  - 키는 환경변수에서만 읽는다. 코드에 기본값(공개 테스트 키 포함)을 두지 않는다.
//  - 운영 배포(Vercel Production)에서는 test_ 키를 받지 않는다 → 실제 돈이 오가지 않는데 "결제완료"가 기록되는 일을 막는다.
//    Preview/로컬(VERCEL_ENV 가 production 이 아님)에서는 테스트 키로 개발·검증할 수 있다.

export const isProductionDeployment = () => process.env.VERCEL_ENV === "production";

export type KeyMode = "test" | "live";

export function keyMode(key: string): KeyMode | null {
  if (key.startsWith("test_")) return "test";
  if (key.startsWith("live_")) return "live";
  return null;
}

/** 지금 환경에서 쓸 수 있는 키면 그대로, 없거나 허용되지 않으면 null. */
export function usablePaymentKey(raw: string | null | undefined): string | null {
  const key = raw?.trim();
  if (!key) return null;
  const mode = keyMode(key);
  if (!mode) return null;
  if (mode === "test" && isProductionDeployment()) return null;
  return key;
}

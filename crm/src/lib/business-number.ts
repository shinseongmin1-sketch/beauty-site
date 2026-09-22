import crypto from "node:crypto";

// 사업자등록번호 / 전화번호 식별값 처리.
//  - 원문은 DB 에 저장하지 않는다. 서버가 비밀값(pepper)으로 만든 HMAC-SHA256 해시(중복 확인용)와
//    마스킹 표기(화면 표시용)만 저장한다. 해시 계산은 이 파일(서버)에서만 한다.
//  - pepper(BUSINESS_NUMBER_PEPPER)는 환경변수로만 관리하며 Git/DB 에 두지 않는다.
//    분실하거나 바꾸면 기존 해시와 새 해시가 달라져 중복 방지가 깨지므로, 안전한 곳에 보관하고
//    교체가 필요하면 identifier_hash_version 을 올려 단계적으로 이전한다.

/** 숫자 10자리(하이픈·공백 허용)면 정규화된 숫자열을, 아니면 null 을 돌려준다. */
export function normalizeBusinessNumber(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

/** 전화번호는 숫자만 남기고, 너무 짧으면(식별 불가) null. */
export function normalizePhone(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function pepper(): string {
  const value = process.env.BUSINESS_NUMBER_PEPPER;
  if (!value || value.length < 16) {
    // 설정이 없으면 (평문 저장/약한 해시로 우회하지 않고) 사업장 생성 자체를 실패시킨다.
    throw new Error("BUSINESS_NUMBER_PEPPER 환경변수가 설정되지 않았습니다.");
  }
  return value;
}

const hmac = (scope: string, digits: string) =>
  crypto.createHmac("sha256", pepper()).update(`${scope}:v1:${digits}`).digest("hex");

export const hashBusinessNumber = (digits: string) => hmac("bn", digits);
export const hashPhone = (digits: string) => hmac("ph", digits);

/** 예: 1111111111 → 111-**-***11 */
export function maskBusinessNumber(digits: string): string {
  return `${digits.slice(0, 3)}-**-***${digits.slice(8)}`;
}

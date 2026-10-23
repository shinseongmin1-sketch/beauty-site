// 로그인 화면의 [자동로그인] 선택을 기억하는 쿠키와, 그 선택에 맞게 로그인 쿠키 수명을 정하는 함수.
// - 자동로그인 체크: 로그인 쿠키를 기존처럼 오래(Supabase 기본값) 유지한다.
// - 체크 안 함: 로그인 쿠키를 "세션 쿠키"로 만든다 → 브라우저·프로그램을 닫으면 로그인이 풀린다.
// 이 쿠키가 없던 기존 로그인(기능 추가 전)은 자동로그인으로 취급해 갑자기 로그아웃되지 않게 한다.
export const REMEMBER_COOKIE = "manion_remember";
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 400; // 400일 (브라우저 쿠키 최대 수명)

export function isRemembered(value: string | undefined): boolean {
  return value !== "0";
}

/** 자동로그인이 아니면 쿠키 옵션에서 만료(maxAge/expires)를 빼서 세션 쿠키로 만든다. */
export function cookieOptionsFor<T extends { maxAge?: number; expires?: Date | number | string }>(
  options: T,
  remember: boolean
): T {
  if (remember || options.maxAge === 0) return options; // 로그아웃(삭제) 쿠키는 그대로 둔다
  const rest = { ...options };
  delete rest.maxAge;
  delete rest.expires;
  return rest;
}

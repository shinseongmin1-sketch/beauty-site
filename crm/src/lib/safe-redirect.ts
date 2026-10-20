// 로그인 후 이동 경로(next) 검증. 같은 사이트 안의 경로만 허용해 오픈 리다이렉트를 막는다.
//   허용: "/dashboard", "/dashboard/customers?x=1", "/admin"
//   거부: "//evil.com", "/\evil.com", "https://evil.com", "/%5Cevil.com" 처럼 브라우저가 다른 사이트로 해석할 수 있는 값
const BASE = "http://same-origin.invalid";

export function safeNextPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2000) return fallback;
  // 반드시 "/" 하나로 시작하는 상대 경로. "//", "/\" 는 브라우저가 다른 호스트로 해석한다.
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // 제어문자·역슬래시(인코딩 포함)가 섞인 값은 브라우저마다 해석이 달라 받지 않는다.
  if (/[\u0000-\u001f\u007f\\]/.test(next) || /%(5c|2f%2f|0[0-9a-f]|1[0-9a-f])/i.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

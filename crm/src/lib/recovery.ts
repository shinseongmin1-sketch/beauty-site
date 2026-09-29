import crypto from "node:crypto";
import { cookies } from "next/headers";

// 비밀번호 재설정(recovery) 전용 표시 쿠키.
//  - 재설정 링크(/auth/confirm 또는 /auth/callback)를 통과한 경우에만 발급된다.
//  - /reset-password 는 "로그인 세션 + 이 쿠키" 가 둘 다 있을 때만 쓸 수 있다.
//    (일반 로그인 세션만으로는 현재 비밀번호 확인 없이 비밀번호를 바꿀 수 없게 하기 위함)
//  - 값은 `${userId}.${만료시각}.${HMAC}` 이다. 사용자가 쿠키를 직접 만들어 넣어도 서명이 맞지 않으면 무효이고,
//    다른 계정의 세션과는 userId 가 달라 쓸 수 없다.
//  - 토큰/비밀번호 등 민감정보는 담지 않는다.

export const RECOVERY_COOKIE = "mn_pw_recovery";
export const RECOVERY_MAX_AGE_SEC = 15 * 60;
// 쿠키가 필요한 곳은 재설정 화면과 그 서버 액션(같은 경로로 POST)뿐이라 경로를 좁혀둔다.
const RECOVERY_COOKIE_PATH = "/reset-password";

/** 재설정 링크 처리 후 이동을 허용하는 내부 경로. 외부 URL·그 외 경로는 전부 거부한다. */
export const RECOVERY_NEXT_PATHS = new Set(["/reset-password"]);

function secret(): string {
  // 전용 비밀값이 있으면 그것을, 없으면 서버 전용 service_role 키에서 파생한다.
  // 둘 다 없으면 서명 없이 발급하지 않고 실패시킨다 (재설정 흐름이 막힐 뿐, 우회 경로는 생기지 않는다).
  const value = process.env.RECOVERY_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || value.length < 16) {
    throw new Error("RECOVERY_COOKIE_SECRET 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  }
  return value;
}

const sign = (payload: string) =>
  crypto.createHmac("sha256", secret()).update(`pw-recovery:v1:${payload}`).digest("base64url");

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: RECOVERY_COOKIE_PATH,
};

/** Route Handler / Server Action 에서만 호출 (쿠키 쓰기) */
export async function issueRecoveryCookie(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + RECOVERY_MAX_AGE_SEC;
  const payload = `${userId}.${exp}`;
  const store = await cookies();
  store.set(RECOVERY_COOKIE, `${payload}.${sign(payload)}`, { ...cookieOptions, maxAge: RECOVERY_MAX_AGE_SEC });
}

/** Route Handler / Server Action 에서만 호출 (쿠키 쓰기) */
export async function clearRecoveryCookie() {
  const store = await cookies();
  store.set(RECOVERY_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

/** 현재 로그인한 userId 에 대해 발급된, 만료되지 않은 서명 쿠키가 있는지 */
export async function hasValidRecoveryCookie(userId: string): Promise<boolean> {
  const raw = (await cookies()).get(RECOVERY_COOKIE)?.value;
  if (!raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [cookieUserId, expStr, sig] = parts;
  if (cookieUserId !== userId) return false;
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  let expected: string;
  try {
    expected = sign(`${cookieUserId}.${expStr}`);
  } catch (e) {
    console.error("[recovery] cookie secret missing", e instanceof Error ? e.message : e);
    return false;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

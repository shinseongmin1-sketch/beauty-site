// S-2 결제 키 사용 규칙 / S-4 로그인 후 이동 경로 검증 (로컬 전용, 네트워크·DB 없음)
//   node --test tests/local/
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "../../src/lib/safe-redirect.ts";
import { keyMode, usablePaymentKey } from "../../src/lib/payment-env.ts";

test("S-4: 같은 사이트 경로는 그대로 허용", () => {
  assert.equal(safeNextPath("/dashboard"), "/dashboard");
  assert.equal(safeNextPath("/dashboard/customers?grade=1#top"), "/dashboard/customers?grade=1#top");
  assert.equal(safeNextPath("/admin"), "/admin");
});

test("S-4: 다른 사이트로 보낼 수 있는 값은 /dashboard 로 바꾼다", () => {
  for (const bad of [
    "//evil.com", "//evil.com/dashboard", "/\\evil.com", "\\\\evil.com", "https://evil.com", "http:evil.com",
    "javascript:alert(1)", "/%5Cevil.com", "/%2F%2Fevil.com", "/\tevil", "/\n//evil.com", "", "dashboard", null, undefined, 123,
  ]) {
    assert.equal(safeNextPath(bad), "/dashboard", String(bad));
  }
});

test("S-2: 키 종류 판별", () => {
  assert.equal(keyMode("test_ck_x"), "test");
  assert.equal(keyMode("live_sk_x"), "live");
  assert.equal(keyMode("sk_x"), null);
});

test("S-2: 운영 배포(VERCEL_ENV=production)에서는 test_ 키를 쓰지 않는다 / 그 외 환경에서는 허용", () => {
  const prev = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    assert.equal(usablePaymentKey("test_sk_abc"), null);
    assert.equal(usablePaymentKey("live_sk_abc"), "live_sk_abc");
    process.env.VERCEL_ENV = "preview";
    assert.equal(usablePaymentKey("test_sk_abc"), "test_sk_abc");
    delete process.env.VERCEL_ENV;
    assert.equal(usablePaymentKey("test_sk_abc"), "test_sk_abc");
    assert.equal(usablePaymentKey(""), null);
    assert.equal(usablePaymentKey(undefined), null);
    assert.equal(usablePaymentKey("unknown_key"), null);
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
});

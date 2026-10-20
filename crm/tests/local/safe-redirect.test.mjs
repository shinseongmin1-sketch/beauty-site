// S-4 로그인 후 이동 경로 검증 (로컬 전용, 네트워크·DB 없음)
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "../../src/lib/safe-redirect.ts";

test("같은 사이트 경로는 그대로 허용", () => {
  assert.equal(safeNextPath("/dashboard"), "/dashboard");
  assert.equal(safeNextPath("/dashboard/customers?x=1"), "/dashboard/customers?x=1");
  assert.equal(safeNextPath("/admin"), "/admin");
});

test("다른 사이트로 보낼 수 있는 값은 /dashboard 로 바꾼다", () => {
  for (const v of ["//evil.com", "/\\evil.com", "https://evil.com", "/%5Cevil.com", "/%2f%2fevil.com", "evil.com", "", null, undefined, 123]) {
    assert.equal(safeNextPath(v), "/dashboard", String(v));
  }
});

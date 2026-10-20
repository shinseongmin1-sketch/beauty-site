// 비밀번호 작성 규칙 (가입·초대 수락·재설정 공통) — 로컬 전용
import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordProblem } from "../../src/lib/password.ts";

test("8자 이상 + 영문 + 숫자면 통과", () => {
  assert.equal(passwordProblem("abcd1234"), null);
  assert.equal(passwordProblem("한글도OK1a비밀번호"), null);
});

test("짧거나, 영문/숫자 중 하나가 없으면 거부", () => {
  for (const pw of ["", "abc123", "abcdefgh", "12345678", "!!!!!!!!"]) {
    assert.ok(passwordProblem(pw), pw);
  }
});

test("72바이트 초과는 거부 (Auth 가 뒤를 잘라 쓰는 것을 막음)", () => {
  assert.ok(passwordProblem("a1" + "x".repeat(71)));
  assert.equal(passwordProblem("a1" + "x".repeat(70)), null);
});

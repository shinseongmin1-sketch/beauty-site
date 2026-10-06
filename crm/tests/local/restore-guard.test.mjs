// restore.mjs 복원 대상 확인 — 어떤 DB 에도 연결하지 않는다.
// CLI 검사는 존재할 수 없는 주소(*.invalid)와 임시 매니페스트/가짜 백업 파일을 쓰고, 대상 확인 직후 단계(파일 형식 검사)에서 멈추는지 본다.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkRestoreTarget, PROTECTED_TEST_REFS } from "../../scripts/lib/restore-guard.mjs";
import { prodRef, root } from "../../scripts/lib/env.mjs";

const SCRATCH = "abcdefghijklmnopqrst";
const OTHER = "zyxwvutsrqponmlkjihg";
const PROD = "prodprodprodprodprod";
const SOURCE = "sourcesourcesourcexx";
const PROTECTED = PROTECTED_TEST_REFS[0];

test("checkRestoreTarget: --confirm 없음 / 빈 값 / 형식 오류 → 거부 (대상 ref 는 메시지에 표시)", () => {
  for (const confirm of [undefined, "", true]) {
    const r = checkRestoreTarget({ targetRef: SCRATCH, confirm });
    assert.equal(r.ok, false);
    assert.match(r.error, new RegExp(SCRATCH));
  }
  assert.equal(checkRestoreTarget({ targetRef: SCRATCH, confirm: "short" }).ok, false);
  assert.equal(checkRestoreTarget({ targetRef: SCRATCH, confirm: SCRATCH.toUpperCase() }).ok, false);
});

test("checkRestoreTarget: --confirm 이 실제 대상과 다르면 거부", () => {
  const r = checkRestoreTarget({ targetRef: SCRATCH, confirm: OTHER });
  assert.equal(r.ok, false);
  assert.match(r.error, /다릅니다/);
});

test("checkRestoreTarget: 운영 프로젝트 / 백업 원본 프로젝트는 confirm 이 맞아도 거부", () => {
  assert.equal(checkRestoreTarget({ targetRef: PROD, confirm: PROD, prodRef: PROD }).ok, false);
  assert.equal(checkRestoreTarget({ targetRef: SOURCE, confirm: SOURCE, backupSourceRef: SOURCE }).ok, false);
  assert.equal(checkRestoreTarget({ targetRef: PROD, confirm: PROD, prodRef: PROD, allowProtected: PROD }).ok, false, "allow 로도 운영은 허용 안 됨");
});

test("checkRestoreTarget: 보존 테스트 프로젝트는 --allow-protected-target=<같은 ref> 가 있어야만 허용", () => {
  assert.equal(checkRestoreTarget({ targetRef: PROTECTED, confirm: PROTECTED }).ok, false);
  assert.equal(checkRestoreTarget({ targetRef: PROTECTED, confirm: PROTECTED, allowProtected: true }).ok, false);
  assert.equal(checkRestoreTarget({ targetRef: PROTECTED, confirm: PROTECTED, allowProtected: OTHER }).ok, false);
  const r = checkRestoreTarget({ targetRef: PROTECTED, confirm: PROTECTED, allowProtected: PROTECTED });
  assert.equal(r.ok, true);
  assert.ok(r.warning);
});

test("checkRestoreTarget: 올바른 검증용 ref → 통과", () => {
  const r = checkRestoreTarget({ targetRef: SCRATCH, confirm: SCRATCH, prodRef: PROD, backupSourceRef: SOURCE });
  assert.deepEqual(r, { ok: true });
});

// ── CLI: scripts/restore.mjs ─────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "restore-guard-"));
const backupFile = path.join(tmp, "prod-20260101T000000Z.json.gz.enc");
fs.writeFileSync(backupFile, "NOTABACKUP"); // 형식 검사에서 멈추게 하는 가짜 파일
fs.writeFileSync(path.join(tmp, "prod-20260101T000000Z.manifest.json"), JSON.stringify({ ref: SOURCE }));

const FAKE_SECRET = "fake-not-a-real-secret";
function runRestore(extraArgs, { ref = SCRATCH, useEnvFile = false } = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("SUPABASE_TEST_") || k === "BACKUP_ENCRYPTION_KEY") delete env[k];
  if (!useEnvFile) {
    Object.assign(env, {
      SUPABASE_TEST_URL: `https://${ref}.invalid`,
      SUPABASE_TEST_ANON_KEY: FAKE_SECRET,
      SUPABASE_TEST_SERVICE_ROLE_KEY: FAKE_SECRET,
      SUPABASE_TEST_ACCESS_TOKEN: FAKE_SECRET,
      BACKUP_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    });
  }
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "restore.mjs"), "--target=test", `--file=${backupFile}`, ...extraArgs], { cwd: root, env, encoding: "utf8", timeout: 30_000 });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.ok(!out.includes(FAKE_SECRET), "출력에 비밀값이 나오면 안 됨");
  return { status: r.status, out };
}
const passedGuard = (out) => out.includes("✔ 대상 확인");

test("CLI: --confirm 없음 → 대상 ref 를 보여주고 거부 (네트워크 전)", () => {
  const { status, out } = runRestore([]);
  assert.equal(status, 1);
  assert.match(out, new RegExp(`복원 대상: 테스트 대상 프로젝트 ${SCRATCH}`));
  assert.match(out, /--confirm=<복원 대상 프로젝트 ref> 가 필요합니다/);
  assert.ok(!passedGuard(out));
});

test("CLI: 잘못된 ref → 거부", () => {
  const { status, out } = runRestore([`--confirm=${OTHER}`]);
  assert.equal(status, 1);
  assert.match(out, /다릅니다/);
  assert.ok(!passedGuard(out));
});

test("CLI: 백업 원본(운영) ref 를 대상으로 지정 → 거부", () => {
  const { status, out } = runRestore([`--confirm=${SOURCE}`], { ref: SOURCE });
  assert.equal(status, 1);
  assert.match(out, /원본 프로젝트/);
  assert.ok(!passedGuard(out));
});

test("CLI: 실제 운영 ref(.env.local) 를 대상으로 지정 → 거부", { skip: !prodRef() && ".env.local 없음" }, () => {
  const ref = prodRef();
  const { status, out } = runRestore([`--confirm=${ref}`, `--allow-protected-target=${ref}`], { ref });
  assert.equal(status, 1);
  assert.ok(!passedGuard(out));
});

test("CLI: 환경변수 없이 .env.test 로 보존 테스트 프로젝트가 잡히면 confirm 해도 거부", { skip: !fs.existsSync(path.join(root, ".env.test")) && ".env.test 없음" }, () => {
  const { status, out } = runRestore([`--confirm=${PROTECTED}`], { useEnvFile: true });
  assert.equal(status, 1);
  assert.match(out, /보존 중인 테스트 프로젝트/);
  assert.ok(!passedGuard(out));
});

test("CLI: 올바른 검증용 ref → 대상 확인 통과 후, 접속 전 단계(백업 파일 형식 검사)에서 멈춤", () => {
  const { status, out } = runRestore([`--confirm=${SCRATCH}`]);
  assert.notEqual(status, 0);
  assert.ok(passedGuard(out), out);
  assert.match(out, /백업 파일 형식이 아닙니다/);
  assert.ok(!out.includes("계정"), "계정 복원(네트워크) 단계에 들어가면 안 됨");
});

after(() =>fs.rmSync(tmp, { recursive: true, force: true }));

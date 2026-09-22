// 운영 적용 전 검증 관문. 순서(005 → 앱 코드 → 006)를 그대로 재현한다.
//
//   1) 로컬 SQL 테스트(PGlite)
//   2) 테스트 프로젝트: 005 까지만 적용
//   3) [005 상태] 새 앱 코드가 쓰는 DB 호출 흐름 테스트 (app-flows) — 잠금 전에도 앱이 정상이어야 함
//   4) 앱 코드 정적 검증 (tsc + eslint)
//   5) 테스트 프로젝트: 006 적용
//   6) [006 상태] 전체 통합 테스트 (app-flows 재실행 + 권한 상승/매장 격리 공격 시나리오)
//
// 전부 통과해야만 supabase/migrations/.verified.json 에 파일별 체크섬이 기록되고,
// migrate.mjs --target=prod 는 이 기록이 있는 파일만 운영에 적용한다.
//
// 처음부터 순서를 재현하려면 테스트 프로젝트가 "깨끗한 상태"여야 한다 (아니면 --allow-dirty 없이는 중단):
//   node scripts/reset-test.mjs --confirm=<테스트 ref>
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadTarget, parseArgs, runSql, root } from "./lib/env.mjs";

const args = parseArgs();
const t = loadTarget("test"); // 테스트 값이 있고 운영 DB 를 가리키지 않는지 먼저 확인

/** node <nodeArgs...> 를 실행하고 실패하면 즉시 중단한다. */
function step(title, nodeArgs) {
  console.log(`\n═══ ${title}`);
  const r = spawnSync(process.execPath, nodeArgs, { cwd: root, stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`\n✖ 실패: ${title}\n  .verified.json 은 갱신되지 않았습니다.`);
    process.exit(1);
  }
}

const bin = (pkgPath) => path.join(root, "node_modules", pkgPath);

// 깨끗한 상태 확인: 이미 006 이 적용돼 있으면 "잠금 전" 단계를 재현할 수 없다.
if (!args["allow-dirty"]) {
  let applied = [];
  try {
    applied = (await runSql(t, "select filename from public._crm_migrations")).map((r) => r.filename);
  } catch {
    /* 추적 테이블이 없으면 새 프로젝트 */
  }
  if (applied.some((f) => Number(f.split("_")[0]) > 5)) {
    console.error(
      `✖ 테스트 프로젝트에 이미 006 이상이 적용돼 있어 "005 → 앱 코드 → 006" 순서를 재현할 수 없습니다.\n` +
        `  node scripts/reset-test.mjs --confirm=${t.ref}  로 초기화한 뒤 다시 실행하세요.`
    );
    process.exit(1);
  }
}

step("1/6 로컬 SQL 테스트", ["scripts/db-local-test.mjs"]);
step("2/6 테스트 프로젝트에 005 까지 적용", ["scripts/migrate.mjs", "--target=test", "--through=5"]);
step("3/6 [005 상태] 앱 DB 호출 흐름 테스트", ["--test", "tests/integration/app-flows.test.mjs"]);
step("4/6 앱 코드 정적 검증 (tsc)", [bin("typescript/bin/tsc"), "--noEmit"]);
step("4/6 앱 코드 정적 검증 (eslint)", [bin("eslint/bin/eslint.js"), "src"]);
step("5/6 테스트 프로젝트에 006 이후 전체 적용 (006, 007, ...)", ["scripts/migrate.mjs", "--target=test"]);

const integrationDir = path.join(root, "tests", "integration");
const testFiles = fs
  .readdirSync(integrationDir)
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => path.join("tests", "integration", f));
step("6/6 [전체 적용 상태] 통합 테스트 (앱 흐름 + 권한 상승 + 직급별 접근 + 직원 초대 + 무료체험/구독 + 운영자/감사 로그 + 고객 Import/Export)", ["--test", "--test-concurrency=1", ...testFiles]);

const sha = (s) => crypto.createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex");
const migDir = path.join(root, "supabase", "migrations");
const entries = { "001_schema.sql": path.join(root, "supabase", "schema.sql") };
for (const f of fs.readdirSync(migDir).filter((f) => /^\d+_.*\.sql$/.test(f))) entries[f] = path.join(migDir, f);

const verified = {};
for (const [name, file] of Object.entries(entries)) {
  verified[name] = { sha256: sha(fs.readFileSync(file, "utf8")), verifiedAt: new Date().toISOString() };
}
fs.writeFileSync(path.join(migDir, ".verified.json"), JSON.stringify(verified, null, 2) + "\n");
console.log(`\n✔ 검증 통과. .verified.json 갱신 (${Object.keys(verified).length}개 파일).`);

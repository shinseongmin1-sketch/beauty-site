// 마이그레이션 적용기 (테스트 → 운영 순서를 코드로 강제한다).
//
//   node scripts/migrate.mjs --target=test                  테스트 프로젝트에 미적용 마이그레이션 적용
//   node scripts/migrate.mjs --target=prod --plan           운영에 실행될 SQL 전체를 파일/화면으로 출력 (실행 안 함)
//   node scripts/migrate.mjs --target=prod --baseline-through=4 --confirm=<ref>
//                                                           (최초 1회) 001~004 는 이미 수동 적용됨 → 기록만 남김
//   node scripts/migrate.mjs --target=prod --confirm=<ref>  운영 적용 (아래 안전장치를 모두 통과해야 함)
//
// 운영 적용 안전장치:
//   1) SUPABASE_PROD_ACCESS_TOKEN 이 "환경변수"로만 전달돼야 함 (파일에서 읽지 않음)
//   2) 적용할 모든 파일이 supabase/migrations/.verified.json 에 (테스트 프로젝트 검증 통과 + 동일 체크섬)으로 기록돼 있어야 함
//   3) --confirm=<운영 프로젝트 ref> 를 사람이 직접 입력해야 함
//   4) 2시간 이내에 만든 운영 백업(backups/prod-*.manifest.json)이 있어야 함
//   5) 각 마이그레이션은 하나의 트랜잭션 안에서 실행되고, 실패하면 통째로 롤백됨
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadTarget, parseArgs, runSql, root } from "./lib/env.mjs";

const args = parseArgs();
const t = loadTarget(args.target);
const sqlDir = path.join(root, "supabase");
const migDir = path.join(sqlDir, "migrations");
const verifiedFile = path.join(migDir, ".verified.json");

const sha = (s) => crypto.createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex");
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const files = [
  { name: "001_schema.sql", file: path.join(sqlDir, "schema.sql") },
  ...fs
    .readdirSync(migDir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: f, file: path.join(migDir, f) })),
].map((f) => {
  // supabase.com 의 SQL Editor / Management API 는 pgcrypto 확장을 이미 제공한다. 내용은 그대로 실행한다.
  const sql = fs.readFileSync(f.file, "utf8");
  return { ...f, sql, checksum: sha(sql), num: Number(f.name.split("_")[0]) };
});

const TRACKING_DDL = `create table if not exists public._crm_migrations (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
alter table public._crm_migrations enable row level security;`;

async function getApplied() {
  try {
    const rows = await runSql(t, "select filename, checksum from public._crm_migrations order by filename");
    return new Map(rows.map((r) => [r.filename, r.checksum]));
  } catch (e) {
    if (/_crm_migrations/.test(e.message) && /does not exist/.test(e.message)) return new Map();
    throw e;
  }
}

function verifiedMap() {
  return fs.existsSync(verifiedFile) ? JSON.parse(fs.readFileSync(verifiedFile, "utf8")) : {};
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// ── baseline (운영 최초 1회) ──────────────────────────────────────────
if (args["baseline-through"]) {
  if (t.target === "prod" && args.confirm !== t.ref) fail(`--confirm=${t.ref} 를 직접 입력해야 합니다.`);
  if (t.target === "prod" && !t.accessToken) fail("SUPABASE_PROD_ACCESS_TOKEN 환경변수가 필요합니다.");
  const upTo = Number(args["baseline-through"]);
  const targets = files.filter((f) => f.num <= upTo);
  const stmts = targets.map(
    (f) => `insert into public._crm_migrations (filename, checksum) values (${q(f.name)}, ${q(f.checksum)}) on conflict do nothing;`
  );
  await runSql(t, `begin;\n${TRACKING_DDL}\n${stmts.join("\n")}\ncommit;`);
  console.log(`✔ 기록만 남김 (SQL 실행 없음): ${targets.map((f) => f.name).join(", ")}`);
  process.exit(0);
}

// ── 대기 목록 ─────────────────────────────────────────────────────────
let applied = new Map();
let appliedKnown = true;
if (t.accessToken) {
  applied = await getApplied();
} else if (args.plan) {
  appliedKnown = false; // 토큰 없이 계획만 볼 때: 기록을 조회할 수 없으므로 baseline(기본 4) 이후 전부를 보여준다.
  const base = Number(args.baseline ?? 4);
  for (const f of files.filter((f) => f.num <= base)) applied.set(f.name, f.checksum);
} else {
  fail("액세스 토큰이 없습니다. (test: .env.test 의 SUPABASE_ACCESS_TOKEN / prod: SUPABASE_PROD_ACCESS_TOKEN 환경변수)");
}

for (const f of files) {
  const prev = applied.get(f.name);
  if (prev && prev !== f.checksum && appliedKnown) {
    fail(`이미 적용된 ${f.name} 의 내용이 바뀌었습니다. 적용된 마이그레이션은 수정하지 말고 새 번호의 파일을 추가하세요.`);
  }
}
// --through=N : N 번 파일까지만 적용 (예: 005 까지 적용 → 앱 코드 검증 → 006 적용 순서를 테스트하기 위함)
const through = args.through ? Number(args.through) : Infinity;
const pending = files.filter((f) => !applied.has(f.name) && f.num <= through);

console.log(`대상: ${t.target} (${t.ref})  ·  미적용 ${pending.length}개${appliedKnown ? "" : " (기록 조회 불가: 추정)"}`);
for (const f of pending) console.log(`  - ${f.name}  sha256=${f.checksum.slice(0, 12)}…`);
if (pending.length === 0) process.exit(0);

// ── 계획 출력 ─────────────────────────────────────────────────────────
if (args.plan) {
  const outDir = path.join(sqlDir, "prod-apply");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(outDir, `PLAN_${t.target}_${stamp}.sql`);
  const body = pending
    .map((f) => `-- ════════ ${f.name}  (sha256 ${f.checksum}) ════════\n${f.sql}`)
    .join("\n\n");
  fs.writeFileSync(out, `-- 이 파일은 실행되는 SQL 을 확인하기 위한 출력본입니다. 실제 적용은 migrate.mjs 만 사용하세요.\n\n${body}\n`);
  const v = verifiedMap();
  console.log("\n검증 상태(테스트 프로젝트 통과 여부):");
  for (const f of pending) console.log(`  ${v[f.name]?.sha256 === f.checksum ? "✔ 검증됨" : "✖ 미검증"}  ${f.name}`);
  console.log(`\n실행될 SQL 전체: ${path.relative(process.cwd(), out)}`);
  process.exit(0);
}

// ── 운영 안전장치 ─────────────────────────────────────────────────────
if (t.target === "prod") {
  if (!t.accessToken) fail("SUPABASE_PROD_ACCESS_TOKEN 환경변수가 필요합니다.");
  if (args.confirm !== t.ref) fail(`운영 적용은 --confirm=${t.ref} 를 직접 입력해야 합니다.`);

  const v = verifiedMap();
  const unverified = pending.filter((f) => v[f.name]?.sha256 !== f.checksum);
  if (unverified.length) {
    fail(`테스트 프로젝트 검증을 통과하지 않은 파일이 있어 운영에 적용할 수 없습니다:\n  ${unverified.map((f) => f.name).join("\n  ")}\n→ npm run db:verify 를 먼저 통과시키세요.`);
  }

  const backupDir = path.join(root, "backups");
  const recent =
    fs.existsSync(backupDir) &&
    fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("prod-") && f.endsWith(".manifest.json"))
      .some((f) => Date.now() - fs.statSync(path.join(backupDir, f)).mtimeMs < 2 * 3600 * 1000);
  if (!recent) fail("2시간 이내의 운영 백업이 없습니다. 먼저 npm run db:backup:prod 를 실행하세요.");
}

// ── 적용 ──────────────────────────────────────────────────────────────
await runSql(t, TRACKING_DDL);
for (const f of pending) {
  const record = `insert into public._crm_migrations (filename, checksum) values (${q(f.name)}, ${q(f.checksum)});`;
  process.stdout.write(`  적용 중 ${f.name} … `);
  await runSql(t, `begin;\n${f.sql}\n;\n${record}\ncommit;`);
  console.log("완료");
}
console.log(`\n✔ ${pending.length}개 적용 완료 (${t.target}).`);

// 로컬 SQL 검증기: 메모리 안의 Postgres(PGlite)에 Supabase 흉내 환경 + schema.sql + 마이그레이션을 순서대로 올리고
// supabase/tests/*.test.sql 을 실행한다. 어떤 DB(운영/테스트 Supabase)에도 연결하지 않는다.
//
// 사용: node scripts/db-local-test.mjs            (모든 *.test.sql)
//       node scripts/db-local-test.mjs privilege  (이름에 privilege 가 포함된 테스트만)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlDir = path.join(root, "supabase");
const read = (p) => fs.readFileSync(p, "utf8");
const filter = process.argv[2];

const db = new PGlite();
await db.exec(read(path.join(sqlDir, "tests", "_supabase_stub.sql")));

// PGlite 에는 pgcrypto 가 없다. gen_random_uuid() 는 PG 내장이라 extension 선언만 제거한다.
const baseline = read(path.join(sqlDir, "schema.sql")).replace(/create extension[^;]*;/gi, "");
await db.exec(baseline);

// UP_TO_MIGRATION=5 처럼 지정하면 그 번호까지만 적용한다 (테스트가 취약점을 실제로 잡는지 확인하는 음성 대조용).
const upTo = Number(process.env.UP_TO_MIGRATION ?? 9999);
const migrations = fs
  .readdirSync(path.join(sqlDir, "migrations"))
  .filter((f) => /^\d+_.*\.sql$/.test(f) && Number(f.split("_")[0]) <= upTo)
  .sort();
for (const f of migrations) {
  try {
    await db.exec(read(path.join(sqlDir, "migrations", f)));
    console.log(`  applied ${f}`);
  } catch (e) {
    console.error(`  FAILED  ${f}: ${e.message}`);
    process.exit(1);
  }
}

const tests = fs
  .readdirSync(path.join(sqlDir, "tests"))
  .filter((f) => f.endsWith(".test.sql") && (!filter || f.includes(filter)))
  .sort();

let failed = 0;
for (const f of tests) {
  const marker = "-- ── 결과";
  const sql = read(path.join(sqlDir, "tests", f));
  const body = sql.includes(marker) ? sql.slice(0, sql.indexOf(marker)) : sql;
  console.log(`\n▶ ${f}`);
  try {
    await db.exec(body);
    const { rows } = await db.query("select ok, name, detail from results order by ok, name");
    for (const r of rows) {
      console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  -> ${r.detail}`}`);
      if (!r.ok) failed++;
    }
    console.log(`  (${rows.filter((r) => r.ok).length}/${rows.length} passed)`);
  } catch (e) {
    console.error(`  ERROR ${e.message}`);
    failed++;
  }
}


// ── 백필 시나리오: 009 적용 "전"에 이미 사업장/데이터가 있던 DB (운영 DB 와 같은 상황) ─────────────
if (!filter && !process.env.UP_TO_MIGRATION) {
  console.log("\n▶ 백필 시나리오 (009 적용 전에 사업장·고객 데이터가 이미 있는 DB)");
  const db2 = new PGlite();
  await db2.exec(read(path.join(sqlDir, "tests", "_supabase_stub.sql")));
  await db2.exec(baseline);
  for (const f of migrations.filter((f) => Number(f.split("_")[0]) <= 8)) await db2.exec(read(path.join(sqlDir, "migrations", f)));
  await db2.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('bf000000-0000-0000-0000-000000000001', 'legacy1@bf.local', '{"full_name":"기존대표1"}'),
      ('bf000000-0000-0000-0000-000000000002', 'legacy2@bf.local', '{"full_name":"기존대표2"}');
    insert into businesses (id, owner_id, name, phone) values
      ('bf100000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000001', '기존매장1', '02-111'),
      ('bf100000-0000-0000-0000-000000000002', 'bf000000-0000-0000-0000-000000000002', '기존매장2', null);
    update profiles set business_id = 'bf100000-0000-0000-0000-000000000001', role = 'owner' where id = 'bf000000-0000-0000-0000-000000000001';
    update profiles set business_id = 'bf100000-0000-0000-0000-000000000002', role = 'owner' where id = 'bf000000-0000-0000-0000-000000000002';
    insert into staff (business_id, profile_id, name, role) values
      ('bf100000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000001', '기존대표1', 'owner');
    insert into customers (business_id, name, phone, memo) values
      ('bf100000-0000-0000-0000-000000000001', '기존고객A', '010-1', '메모A'),
      ('bf100000-0000-0000-0000-000000000001', '기존고객B', '010-2', null),
      ('bf100000-0000-0000-0000-000000000002', '기존고객C', '010-3', null);
  `);
  const before = (await db2.query("select (select count(*) from businesses) b, (select count(*) from customers) c, (select count(*) from profiles) p, (select count(*) from staff) s")).rows[0];
  await db2.exec(read(path.join(sqlDir, "migrations", "009_subscriptions_trials.sql")));
  const after = (await db2.query("select (select count(*) from businesses) b, (select count(*) from customers) c, (select count(*) from profiles) p, (select count(*) from staff) s")).rows[0];
  const checks = [
    ["기존 데이터(사업장/고객/프로필/담당자) 행 수가 그대로", JSON.stringify(before) === JSON.stringify(after)],
    ["모든 기존 사업장에 구독(legacy_backfill trial)이 생김", (await db2.query("select count(*)::int n from subscriptions where trial_source = 'legacy_backfill' and status = 'trial'")).rows[0].n === 2],
    ["백필 체험 기간은 적용 시점부터 3개월", (await db2.query("select count(*)::int n from subscriptions where trial_ends_at = trial_started_at + interval '3 months'")).rows[0].n === 2],
    ["백필 사업장은 즉시 쓰기 가능 (기존 사용자를 막지 않음)", (await db2.query("select bool_and(public.business_is_writable(business_id)) ok from subscriptions")).rows[0].ok === true],
    ["백필 이력 행(사업자번호 미상, hash null)이 사업장마다 1건", (await db2.query("select count(*)::int n from trial_history where source = 'legacy_backfill' and business_number_hash is null and business_id is not null")).rows[0].n === 2],
    ["사업자번호/대표자명은 비어 있음(사후 등록 대상)", (await db2.query("select count(*)::int n from businesses where business_number_hash is null and representative_name is null")).rows[0].n === 2],
  ];
  for (const [name, ok] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed++; }
  console.log(`  (${checks.filter((c) => c[1]).length}/${checks.length} passed)`);
}

process.exit(failed ? 1 : 0);

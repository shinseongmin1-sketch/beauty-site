// 백업/복원 구조 검증 (로컬 전용: 메모리 안의 PGlite + 가짜 PostgREST 응답. 어떤 Supabase 프로젝트에도 연결하지 않는다)
//   node --test tests/local/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { CRM_TABLES, OTHER_APP_TABLES, TABLE_INTRODUCED_BY, primaryKeyOf } from "../../scripts/lib/tables.mjs";
import { countMissingKeys, fetchAllRows } from "../../scripts/lib/backup-io.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, "supabase", p), "utf8");

async function migratedDb() {
  const db = new PGlite();
  await db.exec(read("tests/_supabase_stub.sql"));
  await db.exec(read("schema.sql").replace(/create extension[^;]*;/gi, ""));
  const files = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) await db.exec(read(`migrations/${f}`));
  return db;
}

const db = await migratedDb();

test("백업 목록: public 스키마의 모든 테이블이 백업 대상이거나 다른 앱 테이블이다 (누락 없음)", async () => {
  const { rows } = await db.query(`select tablename from pg_tables where schemaname = 'public'`);
  const unlisted = rows.map((r) => r.tablename).filter((t) => !CRM_TABLES.includes(t) && !OTHER_APP_TABLES.some((re) => re.test(t)));
  assert.deepEqual(unlisted, []);
  assert.equal(CRM_TABLES.length, 26);
  for (const t of Object.keys(TABLE_INTRODUCED_BY)) assert.ok(CRM_TABLES.includes(t));
});

test("복원 순서: 모든 외래키에서 부모 테이블이 자식 테이블보다 먼저 복원된다", async () => {
  const { rows } = await db.query(`
    select c.relname as child, p.relname as parent
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid join pg_namespace cn on cn.oid = c.relnamespace
    join pg_class p on p.oid = k.confrelid join pg_namespace pn on pn.oid = p.relnamespace
    where k.contype = 'f' and cn.nspname = 'public' and pn.nspname = 'public' and c.oid <> p.oid`);
  assert.ok(rows.some((r) => r.child === "customers" && r.parent === "customer_grades"), "customers → customer_grades 외래키가 검사 대상에 포함돼야 함");
  const bad = rows.filter((r) => CRM_TABLES.indexOf(r.parent) > CRM_TABLES.indexOf(r.child));
  assert.deepEqual(bad, [], `순서 위반: ${bad.map((r) => `${r.child} → ${r.parent}`).join(", ")}`);
});

test("기본키 정의(tables.mjs)가 실제 스키마의 기본키와 같다", async () => {
  const { rows } = await db.query(`
    select c.relname as t, array_agg(a.attname order by array_position(k.conkey, a.attnum)) as cols
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
    where k.contype = 'p' and n.nspname = 'public' group by c.relname`);
  const actual = Object.fromEntries(rows.map((r) => [r.t, r.cols]));
  for (const t of CRM_TABLES) assert.deepEqual(primaryKeyOf(t), actual[t], t);
});

// ── 가짜 PostgREST: order=<pk>.asc 정렬, Range 헤더, maxRows 상한, Prefer: count=exact 의 Content-Range ──
function fakeServer(tables, { maxRows = 1000, onRequest } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const table = u.pathname.split("/").pop();
    let rows = [...(tables[table] ?? [])];
    onRequest?.(table, tables);
    const order = u.searchParams.get("order");
    if (order) {
      const cols = order.split(",").map((s) => s.split(".")[0]);
      rows.sort((a, b) => { for (const c of cols) { if (a[c] < b[c]) return -1; if (a[c] > b[c]) return 1; } return 0; });
    }
    const inFilter = [...u.searchParams.entries()].find(([k, v]) => k !== "select" && k !== "order" && v.startsWith("in.("));
    if (inFilter) {
      const wanted = new Set(inFilter[1].slice(4, -1).split(",").map((s) => JSON.parse(s)));
      rows = rows.filter((r) => wanted.has(r[inFilter[0]]));
    }
    const orFilter = u.searchParams.get("or");
    if (orFilter) {
      const groups = [...orFilter.matchAll(/and\(([^)]*)\)/g)].map((m) => Object.fromEntries(
        [...m[1].matchAll(/(\w+)\.eq\.("(?:[^"\\]|\\.)*")/g)].map((x) => [x[1], JSON.parse(x[2])])
      ));
      rows = rows.filter((r) => groups.some((g) => Object.entries(g).every(([k, v]) => r[k] === v)));
    }
    const [from, to] = (init.headers?.Range ?? `0-${rows.length}`).split("-").map(Number);
    const page = rows.slice(from, Math.min(to + 1, from + maxRows));
    const headers = new Map([["content-range", `${from}-${from + page.length - 1}/${rows.length}`]]);
    return { ok: true, status: 206, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, json: async () => page };
  };
}

const sameTime = "2026-10-01T00:00:00Z";
const customers = Array.from({ length: 2503 }, (_, i) => ({ id: `c${String(i).padStart(5, "0")}`, created_at: sameTime }));

test("백업 조회: created_at 이 전부 같은 2,503행도 중복·누락 없이 전부 읽는다", async () => {
  const rows = await fetchAllRows({ url: "http://x", headers: {}, table: "customers", pk: ["id"], fetchImpl: fakeServer({ customers }) });
  assert.equal(rows.length, 2503);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2503);
});

test("백업 조회: 서버 Max Rows(300)가 페이지 크기(1000)보다 작아도 끝까지 읽는다", async () => {
  const rows = await fetchAllRows({ url: "http://x", headers: {}, table: "customers", pk: ["id"], fetchImpl: fakeServer({ customers }, { maxRows: 300 }) });
  assert.equal(rows.length, 2503);
});

test("백업 조회: 도중에 행 수가 바뀌면(동시 쓰기) 백업을 중단한다", async () => {
  let n = 0;
  const server = fakeServer({ customers: [...customers] }, { onRequest: (t, tables) => { if (++n === 2) tables.customers.push({ id: "zzz", created_at: sameTime }); } });
  await assert.rejects(fetchAllRows({ url: "http://x", headers: {}, table: "customers", pk: ["id"], fetchImpl: server }), /행 수가 바뀌었습니다/);
});

test("백업 조회: 복합 기본키 테이블(customer_tag_links)도 전부 읽는다", async () => {
  const links = Array.from({ length: 1205 }, (_, i) => ({ customer_id: `c${i % 400}`, tag_id: `t${Math.floor(i / 400)}`, created_at: sameTime }));
  const rows = await fetchAllRows({ url: "http://x", headers: {}, table: "customer_tag_links", pk: primaryKeyOf("customer_tag_links"), fetchImpl: fakeServer({ customer_tag_links: links }) });
  assert.equal(rows.length, 1205);
});

test("복원 대조: 빠진 행 수를 기본키로 정확히 센다 (단일키/복합키, 대상 DB 에 다른 행이 더 있어도)", async () => {
  const backedUp = customers.slice(0, 250);
  const target = [...customers.slice(3, 250), { id: "other", created_at: sameTime }];
  assert.equal(await countMissingKeys({ url: "http://x", headers: {}, table: "customers", pk: ["id"], rows: backedUp, fetchImpl: fakeServer({ customers: target }) }), 3);

  const links = [{ customer_id: "a", tag_id: "1" }, { customer_id: "a", tag_id: "2" }, { customer_id: "b", tag_id: "1" }];
  const pk = primaryKeyOf("customer_tag_links");
  assert.equal(await countMissingKeys({ url: "http://x", headers: {}, table: "customer_tag_links", pk, rows: links, fetchImpl: fakeServer({ customer_tag_links: links.slice(1) }) }), 1);
});

// 고객 Import/Export(011) 통합 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 실제 Auth JWT 로 PostgREST/RPC 를 직접 호출한다 (화면·서버 액션을 우회하는 공격 경로와 같음).
// Export 는 별도 DB 오브젝트가 없고 RLS(customers_select)만으로 격리되므로, 여기서는 그 RLS 를
// Export 관점(사업장 격리, ID 조작)으로 다시 확인한다. Import(import_customers RPC)는 직접 검증한다.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTarget, mintUserToken } from "../../scripts/lib/env.mjs";

const t = loadTarget("test");
const run = crypto.randomBytes(4).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const SH = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };
const created = [];
const hash = () => crypto.randomBytes(32).toString("hex");

const admin = async (method, p, body) => {
  const r = await fetch(`${t.url}/auth/v1/admin/users${p}`, { method, headers: SH, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : {} };
};
async function mkUser(label) {
  const email = `cie-${run}-${label}@gmail.com`;
  const r = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: `T-${label}` } });
  assert.ok(r.ok, `create ${label}: ${r.status}`);
  created.push(r.json.id);
  const token = (await mintUserToken(t, { id: r.json.id, email })) ?? (await (await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) })).json()).access_token;
  return { id: r.json.id, email, token };
}
const call = async (u, method, pq, body) => {
  const headers = { apikey: t.anonKey, "Content-Type": "application/json", Prefer: "return=representation", ...(u ? { Authorization: `Bearer ${u.token}` } : {}) };
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: r.status, ok: r.ok, json, rows: Array.isArray(json) ? json.length : null, code: json?.code, message: json?.message ?? "" };
};
const rpc = (u, fn, args = {}) => call(u, "POST", `rpc/${fn}`, args);
const svc = async (method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { ...SH, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  assert.ok(r.ok, `svc ${method} ${pq}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
};
const logs = (q) => svc("GET", `audit_logs?${q}&order=seq.asc&select=*`);
const importRow = (name, extra = {}) => ({ name, phone: null, memo: null, grade_name: null, tag_names: [], ...extra });

let O, M, S, OY, U, bizA, bizY, ids = {};

before(async () => {
  [O, M, S, OY, U] = await Promise.all(["o", "m", "s", "oy", "u"].map(mkUser));
  const create = async (u, name) => (await rpc(u, "create_my_business", { p_name: name, p_representative_name: "대표", p_business_number_hash: hash(), p_business_number_masked: "***" })).json;
  bizA = await create(O, `CIE-A-${run}`);
  bizY = await create(OY, `CIE-Y-${run}`);
  await svc("PATCH", `profiles?id=eq.${M.id}`, { business_id: bizA, role: "manager" });
  await svc("PATCH", `profiles?id=eq.${S.id}`, { business_id: bizA, role: "staff" });
  await svc("POST", "staff", { business_id: bizA, profile_id: M.id, name: "관리자", role: "manager" });
  await svc("POST", "staff", { business_id: bizA, profile_id: S.id, name: "직원", role: "staff" });
  ids.gradeA = (await svc("POST", "customer_grades", { business_id: bizA, name: "VIP" }))[0].id;
  ids.tagA = (await svc("POST", "customer_tags", { business_id: bizA, name: "단골" }))[0].id;
  ids.custA = (await svc("POST", "customers", { business_id: bizA, name: "A고객", phone: "010-1000-0001", memo: "원본메모" }))[0].id;
  ids.custY = (await svc("POST", "customers", { business_id: bizY, name: "Y고객", phone: "010-9000-0001" }))[0].id;
});

after(async () => {
  for (const id of created) await admin("DELETE", `/${id}`);
});

// ══ Export 관점: 사업장 격리 (Export 는 customers_select RLS 에 그대로 의존) ══
test("Export 기반 RLS: 대표는 자기 사업장 고객만 조회, 다른 사업장 고객은 ID 를 알아도 안 보임", async () => {
  const own = await call(O, "GET", `customers?business_id=eq.${bizA}&select=id,name`);
  assert.ok(own.ok && own.rows === 1 && own.json[0].id === ids.custA);
  const byId = await call(O, "GET", `customers?id=eq.${ids.custY}&select=id,name`);
  assert.deepEqual(byId.json, [], "다른 사업장 고객이 ID 조회로 노출됨");
  const spoofed = await call(O, "GET", `customers?business_id=eq.${bizY}&select=id,name`);
  assert.deepEqual(spoofed.json, [], "business_id 를 다른 값으로 바꿔도 조회됨");
});
test("직원도 조회 자체는 가능(007 유지) — 단, Export 액션은 서버에서 별도로 권한 검사(dataExport)", async () => {
  const asStaff = await call(S, "GET", `customers?business_id=eq.${bizA}&select=id`);
  assert.ok(asStaff.ok && asStaff.rows === 1, "직원의 일반 조회 권한(007)이 깨짐");
});

// ══ Import 권한 (007 기준: 대표/관리자만) ══
test("직원 → import_customers 호출 차단(forbidden), 무소속 → 차단, 다른 사업장 대표는 자기 사업장에만 영향", async () => {
  const s = await rpc(S, "import_customers", { p_rows: [importRow("직원시도")] });
  assert.ok(!s.ok && s.code === "42501", `${s.status} ${s.message}`);
  const u = await rpc(U, "import_customers", { p_rows: [importRow("무소속시도")] });
  assert.ok(!u.ok && u.code === "42501");
  assert.equal((await svc("GET", `customers?name=eq.${encodeURIComponent("직원시도")}&select=id`)).length, 0);
});
test("대표 Import 성공, 관리자 Import 성공 (007 과 동일하게 owner/manager 둘 다 허용)", async () => {
  const o = await rpc(O, "import_customers", { p_rows: [importRow(`대표등록${run}`, { phone: "010-2000-0001" })] });
  assert.ok(o.ok, `${o.status} ${o.message}`);
  assert.deepEqual(o.json, { inserted: 1, updated: 0 });
  const m = await rpc(M, "import_customers", { p_rows: [importRow(`관리자등록${run}`, { phone: "010-2000-0002" })] });
  assert.ok(m.ok, `${m.status} ${m.message}`);
  assert.deepEqual(m.json, { inserted: 1, updated: 0 });
});

// ══ 타 사업장 데이터 주입 차단 ══
test("다른 사업장을 대상으로 지정할 방법이 없다: business_id/customer_id 를 끼워 넣어도 호출자 자신의 사업장에만 반영", async () => {
  const r = await rpc(OY, "import_customers", { p_rows: [{ ...importRow(`위조시도${run}`, { phone: "010-2000-0003" }), business_id: bizA, customer_id: ids.custA }] });
  assert.ok(r.ok, `${r.status} ${r.message}`);
  const [row] = await svc("GET", `customers?phone=eq.010-2000-0003&select=business_id`);
  assert.equal(row.business_id, bizY, "다른 사업장(A)에 생성됨");
});

// ══ 검증: 필수 컬럼/형식/등급·태그 존재/원자성 ══
test("이름 없음/전화번호 형식 오류/존재하지 않는 등급·태그 → 차단, 자동 생성 없음", async () => {
  assert.ok(!(await rpc(O, "import_customers", { p_rows: [importRow("")] })).ok, "빈 이름");
  assert.ok(!(await rpc(O, "import_customers", { p_rows: [importRow("x", { phone: "123" })] })).ok, "짧은 전화번호");
  const badGrade = await rpc(O, "import_customers", { p_rows: [importRow("x", { grade_name: "없는등급" })] });
  assert.ok(!badGrade.ok);
  assert.equal((await svc("GET", "customer_grades?name=eq.없는등급&select=id")).length, 0, "등급이 자동 생성됨");
  const badTag = await rpc(O, "import_customers", { p_rows: [importRow("x", { tag_names: ["없는태그"] })] });
  assert.ok(!badTag.ok);
  assert.equal((await svc("GET", "customer_tags?name=eq.없는태그&select=id")).length, 0, "태그가 자동 생성됨");
});
test("원자성: 여러 행 중 1건만 오류여도 전체 롤백된다", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => importRow(`원자성${run}-${i}`, { phone: `010-3${String(i).padStart(6, "0")}` }));
  rows.push(importRow("오류행", { grade_name: "존재안함" }));
  const r = await rpc(O, "import_customers", { p_rows: rows });
  assert.ok(!r.ok);
  const count = await svc("GET", `customers?name=like.원자성${run}-*&select=id`);
  assert.equal(count.length, 0, "일부가 반영됨(부분 커밋 발생)");
});
test("2,000행 초과 → 차단", async () => {
  const rows = Array.from({ length: 2001 }, (_, i) => importRow(`n${i}`));
  const r = await rpc(O, "import_customers", { p_rows: rows });
  assert.ok(!r.ok && /too_many_rows/.test(r.message));
});

// ══ 전화번호 정규화 + 중복(기존 고객 갱신) + 빈 값=유지 ══
test("전화번호 정규화: 표기가 달라도 같은 사업장 안에서 같은 고객으로 인식되어 갱신됨", async () => {
  const c1 = await rpc(O, "import_customers", { p_rows: [importRow(`정규화${run}`, { phone: "010-4000-0001" })] });
  assert.deepEqual(c1.json, { inserted: 1, updated: 0 });
  const c2 = await rpc(O, "import_customers", { p_rows: [importRow(`정규화${run}`, { phone: "01040000001", memo: "두번째" })] });
  assert.deepEqual(c2.json, { inserted: 0, updated: 1 }, "표기만 다른 같은 번호가 신규로 처리됨");
  assert.equal((await svc("GET", `customers?phone=eq.010-4000-0001&select=id`)).length + (await svc("GET", `customers?phone=eq.01040000001&select=id`)).length, 1);
});
test("빈 값은 기존 값을 지우지 않는다: 메모/등급/태그가 있는 고객에 빈 셀로 다시 Import 해도 그대로 유지", async () => {
  await rpc(O, "import_customers", { p_rows: [importRow("A고객", { phone: "010-1000-0001", grade_name: "VIP", tag_names: ["단골"] })] });
  const [before_] = await svc("GET", `customers?id=eq.${ids.custA}&select=memo,grade_id`);
  assert.equal(before_.memo, "원본메모", "사전 조건: 메모가 준비돼 있어야 함");
  assert.equal(before_.grade_id, ids.gradeA);
  const r = await rpc(O, "import_customers", { p_rows: [importRow("A고객", { phone: "010-1000-0001" })] }); // memo/grade/tag 모두 빈 값
  assert.ok(r.ok, `${r.status} ${r.message}`);
  assert.deepEqual(r.json, { inserted: 0, updated: 1 });
  const [after_] = await svc("GET", `customers?id=eq.${ids.custA}&select=memo,grade_id,name`);
  assert.equal(after_.memo, "원본메모", "빈 값 Import 로 메모가 지워짐");
  assert.equal(after_.grade_id, ids.gradeA, "빈 값 Import 로 등급이 지워짐");
  const tagCount = await svc("GET", `customer_tag_links?customer_id=eq.${ids.custA}&select=tag_id`);
  assert.equal(tagCount.length, 1, "태그가 사라짐");
});
test("전화번호 없는 고객은 이름이 같아도 항상 신규 등록(자동 병합 금지)", async () => {
  const r1 = await rpc(O, "import_customers", { p_rows: [importRow(`전화없음${run}`)] });
  const r2 = await rpc(O, "import_customers", { p_rows: [importRow(`전화없음${run}`)] });
  assert.deepEqual(r1.json, { inserted: 1, updated: 0 });
  assert.deepEqual(r2.json, { inserted: 1, updated: 0 }, "이름만 같은 고객이 병합됨");
  assert.equal((await svc("GET", `customers?name=eq.${encodeURIComponent(`전화없음${run}`)}&select=id`)).length, 2);
});

// ══ 체험 종료 후 차단 (009 유지) ══
test("체험 종료 후에는 대표도 Import 할 수 없다 (조회/Export 는 별개)", async () => {
  const t2 = await mkUser("expired-owner");
  const biz = (await rpc(t2, "create_my_business", { p_name: `만료${run}`, p_representative_name: "대표", p_business_number_hash: hash(), p_business_number_masked: "***" })).json;
  await svc("PATCH", `subscriptions?business_id=eq.${biz}`, { status: "expired", trial_started_at: new Date(Date.now() - 100 * 86_400_000).toISOString(), trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() });
  const r = await rpc(t2, "import_customers", { p_rows: [importRow("만료후고객")] });
  assert.ok(!r.ok && /subscription_inactive/.test(r.message));
  assert.ok((await call(t2, "GET", `customers?business_id=eq.${biz}`)).ok, "체험 종료 후 조회까지 막힘(Export 기반이 깨짐)");
});

// ══ 동시성: 두 명이 같은 신규 전화번호로 거의 동시에 Import → 중복 생성 없음 ══
test("동시성: 대표·관리자가 같은 순간에 같은 전화번호로 Import 해도 고객이 1명만 생성된다", async () => {
  const phone = "010-6000-0001";
  const [r1, r2] = await Promise.all([
    rpc(O, "import_customers", { p_rows: [importRow(`동시성${run}`, { phone })] }),
    rpc(M, "import_customers", { p_rows: [importRow(`동시성${run}`, { phone })] }),
  ]);
  assert.ok(r1.ok && r2.ok, `${JSON.stringify(r1)} / ${JSON.stringify(r2)}`);
  const outcomes = [r1.json, r2.json];
  const totalInserted = outcomes.reduce((s, o) => s + o.inserted, 0);
  const totalUpdated = outcomes.reduce((s, o) => s + o.updated, 0);
  assert.equal(totalInserted, 1, `동시 요청 중 정확히 1건만 insert 여야 함 (실제 inserted 합계=${totalInserted})`);
  assert.equal(totalUpdated, 1, `나머지 1건은 advisory lock 덕에 update 로 처리돼야 함 (실제=${totalUpdated})`);
  const rows = await svc("GET", `customers?phone=eq.${phone}&select=id`);
  assert.equal(rows.length, 1, "같은 전화번호의 고객이 중복 생성됨");
});

// ══ audit_logs 개인정보 미포함 확인 (import_customers 자체는 트리거 대상 아님 —
//   customer.import/export 는 app 코드가 audit_log_server 로 기록하므로 여기서는 그 함수가
//   허용하는 metadata 형태(개수만)가 실제로 저장되는지, 개인정보 키가 거부되는지 직접 확인한다) ══
test("customer.export/import 로그는 개수만 남기고, 개인정보 metadata 는 DB 가 거부한다", async () => {
  const ok1 = await rpc({ token: t.serviceKey }, "audit_log_server", {
    p_business: bizA, p_actor_user: O.id, p_actor_type: "owner", p_action: "customer.export",
    p_resource_type: "customer", p_resource_id: null, p_result: "success",
    p_metadata: { format: "csv", row_count: 12 }, p_ip: null, p_ua: null,
  });
  assert.ok(ok1.ok, `${ok1.status} ${ok1.message}`);
  const ok2 = await rpc({ token: t.serviceKey }, "audit_log_server", {
    p_business: bizA, p_actor_user: O.id, p_actor_type: "owner", p_action: "customer.import",
    p_resource_type: "customer", p_resource_id: null, p_result: "success",
    p_metadata: { format: "csv", row_count: 10, success_count: 9, error_count: 0 }, p_ip: null, p_ua: null,
  });
  assert.ok(ok2.ok, `${ok2.status} ${ok2.message}`);
  const bad = await rpc({ token: t.serviceKey }, "audit_log_server", {
    p_business: bizA, p_actor_user: O.id, p_actor_type: "owner", p_action: "customer.export",
    p_resource_type: "customer", p_resource_id: null, p_result: "success",
    p_metadata: { format: "csv", row_count: 1, customer_name: "홍길동" }, p_ip: null, p_ua: null,
  });
  assert.ok(!bad.ok && /audit_metadata_rejected/.test(bad.message), "허용되지 않은 키(customer_name)가 통과됨");
  const exp = (await logs(`action=eq.customer.export&business_id=eq.${bizA}`)).at(-1);
  assert.deepEqual(exp.metadata, { format: "csv", row_count: 12 });
  const imp = (await logs(`action=eq.customer.import&business_id=eq.${bizA}`)).at(-1);
  assert.deepEqual(imp.metadata, { format: "csv", row_count: 10, success_count: 9, error_count: 0 });
  const dump = JSON.stringify([exp, imp]);
  assert.ok(!dump.includes("홍길동") && !/[가-힣]/.test(JSON.stringify([exp.metadata, imp.metadata])), "개인정보/한글이 metadata 에 있음");
});
test("직원/무소속은 customer.export·import 로그를 남기는 함수(audit_log_server)를 직접 호출할 수 없다", async () => {
  for (const u of [S, U]) {
    const r = await rpc(u, "audit_log_server", { p_business: bizA, p_actor_type: "owner", p_action: "customer.export", p_resource_type: "customer", p_result: "success" });
    assert.ok(!r.ok, "authenticated 가 audit_log_server 를 호출함");
  }
});

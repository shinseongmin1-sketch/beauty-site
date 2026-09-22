// 무료체험 / 구독(009) 통합 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 실제 Auth JWT 로 PostgREST/RPC 를 직접 호출한다 (화면·서버 액션을 우회하는 공격 경로와 같음).
//
// 사업자번호 해시는 앱 서버가 만들지만 DB 는 "같은 값인지"만 본다. 여기서는 실행마다 다른 솔트를 섞은 sha256 으로
// 같은 번호 = 같은 해시가 되도록 흉내낸다 (무료체험 이력은 계정 삭제 후에도 남으므로 실행 간 충돌을 피하려는 것).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTarget, mintUserToken } from "../../scripts/lib/env.mjs";

const t = loadTarget("test");
const run = crypto.randomBytes(4).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const SH = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };
const created = [];

const hashOf = (n) => crypto.createHash("sha256").update(`${run}:bn:${n}`).digest("hex");
const phoneHashOf = (n) => crypto.createHash("sha256").update(`${run}:ph:${n}`).digest("hex");

const admin = async (method, p, body) => {
  const r = await fetch(`${t.url}/auth/v1/admin/users${p}`, { method, headers: SH, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : {} };
};
async function mkUser(label) {
  const email = `sub-${run}-${label}@gmail.com`;
  const r = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: `T-${label}` } });
  assert.ok(r.ok, `create ${label}: ${r.status}`);
  created.push(r.json.id);
  // 로그인 요청 한도(429)를 피하려고 테스트 프로젝트 서명 키로 토큰을 발급한다. "로그인이 허용되는가"를 보는 검사만 실제 로그인을 쓴다.
  return { id: r.json.id, email, token: (await mintUserToken(t, { id: r.json.id, email })) ?? (await login(email)) };
}
async function login(email) {
  const r = await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  return r.ok ? (await r.json()).access_token : null;
}
const call = async (u, method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { apikey: t.anonKey, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: r.status, ok: r.ok, json, rows: Array.isArray(json) ? json.length : null, code: json?.code, message: json?.message ?? "" };
};
const svc = async (method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { ...SH, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  assert.ok(r.ok, `svc ${method} ${pq}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
};
const createBiz = (u, name, number, phoneN) =>
  call(u, "POST", "rpc/create_my_business", {
    p_name: name,
    p_phone: "02-1234-5678",
    p_representative_name: "대표",
    p_business_number_hash: hashOf(number),
    p_business_number_masked: `${String(number).slice(0, 3)}-**-***${String(number).slice(8)}`,
    ...(phoneN ? { p_phone_hash: phoneHashOf(phoneN) } : {}),
  });
const mySub = async (u, biz) => (await call(u, "GET", `subscriptions?business_id=eq.${biz}&select=*`)).json?.[0];
const blocked = (r) => !r.ok || r.rows === 0;
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 86_400_000;
const trialCount = async (number) => (await svc("GET", `trial_history?business_number_hash=eq.${hashOf(number)}&select=id`)).length;

// ══════════════════════════════════════════════════════════════════════
// 중복 방지 시나리오: A → B → (A 탈퇴) → C → D
// ══════════════════════════════════════════════════════════════════════
const NUM_A = "1111111111", NUM_D = "2222222222";
let A, B, C, D, bizA, bizB, bizC, bizD;

test("A: 사업자번호 1111111111 → 3개월 무료체험 시작 (시작/종료일 저장)", async () => {
  A = await mkUser("a");
  const r = await createBiz(A, `A-${run}`, NUM_A);
  assert.ok(r.ok, `${r.status} ${JSON.stringify(r.json)}`);
  bizA = r.json;
  const s = await mySub(A, bizA);
  assert.equal(s.status, "trial");
  assert.equal(s.trial_denied_reason, null);
  assert.equal(s.trial_source, "signup");
  const days = daysBetween(s.trial_started_at, s.trial_ends_at);
  assert.ok(days >= 89 && days <= 92, `체험 기간이 3개월이 아님: ${days}일`);
  assert.equal(await trialCount(NUM_A), 1);
  const [h] = await svc("GET", `trial_history?business_number_hash=eq.${hashOf(NUM_A)}&select=business_id,status,trial_ends_at`);
  assert.equal(h.business_id, bizA); assert.equal(h.status, "active");
  // 사업장 행에는 해시/마스킹만 저장되고 원문은 어디에도 없다
  const [b] = await svc("GET", `businesses?id=eq.${bizA}&select=*`);
  assert.equal(b.business_number_hash, hashOf(NUM_A));
  assert.equal(b.business_number_masked, "111-**-***11");
  assert.ok(!JSON.stringify(b).includes(NUM_A), "사업자번호 원문이 businesses 에 있음");
  assert.ok(!JSON.stringify(h).includes(NUM_A), "사업자번호 원문이 trial_history 에 있음");
});

test("무료체험 중: A 는 고객/예약/상담/매출 등록과 매장 설정 변경이 가능", async () => {
  const c = await call(A, "POST", "customers", { business_id: bizA, name: "체험중고객", phone: "010-1111-1111" });
  assert.ok(c.ok, `고객 ${c.status} ${c.message}`);
  const cid = c.json[0].id;
  const start = new Date(Date.now() + 86_400_000).toISOString(), end = new Date(Date.now() + 90_000_000).toISOString();
  assert.ok((await call(A, "POST", "reservations", { business_id: bizA, customer_id: cid, start_time: start, end_time: end, status: "confirmed" })).ok, "예약");
  assert.ok((await call(A, "POST", "consultations", { business_id: bizA, customer_id: cid, content: "상담" })).ok, "상담");
  assert.ok((await call(A, "POST", "payments", { business_id: bizA, customer_id: cid, gross_amount: 1000, amount: 1000, status: "paid" })).ok, "매출");
  assert.ok((await call(A, "PATCH", `businesses?id=eq.${bizA}`, { name: `A-${run}(수정)` })).ok, "설정");
});

test("B: 같은 사업자번호로 새 계정 가입 → 무료체험 거부 (사업장은 생성, 이력은 1건 그대로)", async () => {
  B = await mkUser("b");
  const r = await createBiz(B, `B-${run}`, NUM_A);
  assert.ok(r.ok, `${r.status} ${JSON.stringify(r.json)}`);
  bizB = r.json;
  const s = await mySub(B, bizB);
  assert.equal(s.status, "expired");
  assert.equal(s.trial_denied_reason, "business_number_used");
  assert.equal(s.trial_started_at, null);
  assert.equal(await trialCount(NUM_A), 1, "이력이 중복 생성됨");
});

test("B(체험 거부): 로그인·조회는 되지만 등록/수정/삭제는 API 직접 호출도 차단", async () => {
  assert.ok(await login(B.email), "체험이 거부돼도 로그인은 허용");
  assert.equal((await call(B, "GET", `businesses?id=eq.${bizB}&select=id`)).rows, 1, "자기 사업장 조회");
  assert.ok((await call(B, "GET", `customers?business_id=eq.${bizB}`)).ok, "고객 조회");
  assert.ok(blocked(await call(B, "POST", "customers", { business_id: bizB, name: "B고객" })));
  assert.ok(blocked(await call(B, "PATCH", `businesses?id=eq.${bizB}`, { name: "변경" })));
  assert.ok(blocked(await call(B, "POST", "services", { business_id: bizB, name: "메뉴" })));
  assert.equal((await svc("GET", `customers?business_id=eq.${bizB}&select=id`)).length, 0);
});

test("A 계정 탈퇴 후: 사업장/구독은 삭제되지만 무료체험 이력은 남는다", async () => {
  const del = await admin("DELETE", `/${A.id}`);
  assert.ok(del.ok, `탈퇴 ${del.status}`);
  assert.equal((await svc("GET", `businesses?id=eq.${bizA}&select=id`)).length, 0, "사업장이 남아 있음");
  assert.equal((await svc("GET", `subscriptions?business_id=eq.${bizA}&select=id`)).length, 0);
  const [h] = await svc("GET", `trial_history?business_number_hash=eq.${hashOf(NUM_A)}&select=business_id,status`);
  assert.equal(h.business_id, null, "이력의 사업장 연결은 비워져야 함");
  assert.equal(await trialCount(NUM_A), 1, "탈퇴로 이력이 삭제됨");
});

test("C: A 탈퇴 후 같은 사업자번호로 가입 → 무료체험 거부", async () => {
  C = await mkUser("c");
  const r = await createBiz(C, `C-${run}`, NUM_A);
  assert.ok(r.ok, `${r.status} ${JSON.stringify(r.json)}`);
  bizC = r.json;
  const s = await mySub(C, bizC);
  assert.equal(s.status, "expired");
  assert.equal(s.trial_denied_reason, "business_number_used");
  assert.equal(await trialCount(NUM_A), 1, "재가입으로 체험이 재지급됨");
  assert.ok(blocked(await call(C, "POST", "customers", { business_id: bizC, name: "C고객" })));
});

test("D: 다른 사업자번호로 가입 → 무료체험 가능, 등록도 가능", async () => {
  D = await mkUser("d");
  const r = await createBiz(D, `D-${run}`, NUM_D);
  assert.ok(r.ok, `${r.status} ${JSON.stringify(r.json)}`);
  bizD = r.json;
  assert.equal((await mySub(D, bizD)).status, "trial");
  assert.ok((await call(D, "POST", "customers", { business_id: bizD, name: "D고객" })).ok);
});

test("체험 이력/운영 설정은 어떤 브라우저 권한으로도 조회·조작 불가 (재가입 우회 방지)", async () => {
  for (const u of [D, B]) {
    const th = await call(u, "GET", "trial_history?select=*");
    assert.ok(!th.ok || th.json.length === 0, "trial_history 조회됨");
    assert.ok(!(await call(u, "GET", "platform_settings?select=*")).ok || (await call(u, "GET", "platform_settings?select=*")).json.length === 0, "platform_settings 조회됨");
    assert.ok(blocked(await call(u, "DELETE", "trial_history?business_number_hash=not.is.null")), "이력 삭제 시도");
    assert.ok(blocked(await call(u, "POST", "trial_history", { business_number_hash: "0".repeat(64), trial_started_at: new Date().toISOString(), trial_ends_at: new Date().toISOString() })));
  }
  assert.equal(await trialCount(NUM_A), 1);
  assert.ok((await svc("GET", `trial_history?business_number_hash=eq.${hashOf(NUM_D)}&select=id`)).length === 1);
});

test("체험 연장/구독 상태 조작 시도 차단 (직접 API)", async () => {
  const before_ = await mySub(D, bizD);
  assert.ok(blocked(await call(D, "PATCH", `subscriptions?business_id=eq.${bizD}`, { trial_ends_at: "2099-01-01T00:00:00Z" })));
  assert.ok(blocked(await call(D, "PATCH", `subscriptions?business_id=eq.${bizD}`, { status: "active" })));
  assert.ok(blocked(await call(D, "POST", "subscriptions", { business_id: bizD, status: "active" })));
  assert.ok(blocked(await call(B, "PATCH", `subscriptions?business_id=eq.${bizB}`, { status: "trial", trial_started_at: new Date().toISOString(), trial_ends_at: "2099-01-01T00:00:00Z" })));
  assert.ok(blocked(await call(B, "DELETE", `subscriptions?business_id=eq.${bizB}`)));
  const after_ = await mySub(D, bizD);
  assert.deepEqual(after_, before_, "구독 행이 바뀜");
  assert.equal((await mySub(B, bizB)).status, "expired");
});

test("체험 거부 계정이 새 사업장을 만들어 체험을 다시 받는 우회 불가 (이미 사업장이 있음)", async () => {
  const r = await createBiz(B, `B2-${run}`, "3333333333");
  assert.ok(!r.ok); assert.equal(r.code, "23505");
});

test("사업자번호 해시 없이/잘못된 형식으로는 사업장을 만들 수 없다", async () => {
  const E = await mkUser("e");
  const noHash = await call(E, "POST", "rpc/create_my_business", { p_name: "무번호" });
  assert.ok(!noHash.ok); assert.equal(noHash.code, "22023");
  const bad = await call(E, "POST", "rpc/create_my_business", { p_name: "형식오류", p_business_number_hash: "abc" });
  assert.ok(!bad.ok); assert.equal(bad.code, "22023");
});

// ══════════════════════════════════════════════════════════════════════
// 전화번호 = 보조 신호
// ══════════════════════════════════════════════════════════════════════
test("전화번호 보조 신호: 같은 번호로 3곳까지는 지급(다른 사업자번호), 4번째는 거부", async () => {
  const results = [];
  for (const [i, n] of ["4444444441", "4444444442", "4444444443", "4444444444"].entries()) {
    const u = await mkUser(`p${i}`);
    const r = await createBiz(u, `P${i}-${run}`, n, "010-9999-0000");
    assert.ok(r.ok, `${r.status} ${JSON.stringify(r.json)}`);
    results.push((await mySub(u, r.json)));
  }
  assert.deepEqual(results.map((s) => s.status), ["trial", "trial", "trial", "expired"]);
  assert.equal(results[3].trial_denied_reason, "phone_limit");
  const hist = await svc("GET", `trial_history?phone_hash=eq.${phoneHashOf("010-9999-0000")}&select=phone_seen_before`);
  assert.equal(hist.length, 3);
  assert.equal(hist.filter((h) => h.phone_seen_before).length, 2, "재사용 플래그 기록");
});

// ══════════════════════════════════════════════════════════════════════
// 체험 종료 후 (사업장 X: 대표/관리자/직원) + 사업장 격리 (사업장 Y 는 체험 중)
// ══════════════════════════════════════════════════════════════════════
let OX, MX, SX, OY, bizX, bizY, ids = {};

before(async () => {
  [OX, MX, SX, OY] = await Promise.all([mkUser("ox"), mkUser("mx"), mkUser("sx"), mkUser("oy")]);
  bizX = (await createBiz(OX, `X-${run}`, "5555555555")).json;
  bizY = (await createBiz(OY, `Y-${run}`, "6666666666")).json;
  await svc("PATCH", `profiles?id=eq.${MX.id}`, { business_id: bizX, role: "manager" });
  await svc("PATCH", `profiles?id=eq.${SX.id}`, { business_id: bizX, role: "staff" });
  const st = async (b, name, role, profile) => (await svc("POST", "staff", { business_id: b, name, role, ...(profile ? { profile_id: profile } : {}) }))[0].id;
  ids.stM = await st(bizX, "관리자", "manager", MX.id);
  ids.stS = await st(bizX, "직원", "staff", SX.id);
  ids.stLabel = await st(bizX, "라벨직원", "staff");
  ids.custX = (await svc("POST", "customers", { business_id: bizX, name: "X고객", phone: "010-0000-0000", memo: "원본" }))[0].id;
  ids.custX2 = (await svc("POST", "customers", { business_id: bizX, name: "X고객-삭제용" }))[0].id;
  const start = new Date(Date.now() + 86_400_000).toISOString(), end = new Date(Date.now() + 90_000_000).toISOString();
  ids.resX = (await svc("POST", "reservations", { business_id: bizX, customer_id: ids.custX, start_time: start, end_time: end, status: "confirmed", memo: "원본" }))[0].id;
  ids.consX = (await svc("POST", "consultations", { business_id: bizX, customer_id: ids.custX, content: "원본" }))[0].id;
  ids.payX = (await svc("POST", "payments", { business_id: bizX, customer_id: ids.custX, gross_amount: 1000, amount: 1000, status: "paid" }))[0].id;
  ids.svcX = (await svc("POST", "services", { business_id: bizX, name: "커트", price: 10000 }))[0].id;
  ids.pmX = (await svc("GET", `payment_methods?business_id=eq.${bizX}&select=id&limit=1`))[0].id;
  ids.custY = (await svc("POST", "customers", { business_id: bizY, name: "Y고객" }))[0].id;
});

const expireX = async () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const started = new Date(Date.now() - 91 * 86_400_000).toISOString();
  await svc("PATCH", `subscriptions?business_id=eq.${bizX}`, { trial_started_at: started, trial_ends_at: past });
  await svc("PATCH", `trial_history?business_id=eq.${bizX}`, { trial_started_at: started, trial_ends_at: past });
};

test("체험 중(X): 대표·관리자·직원의 기존 권한(007)이 그대로 동작", async () => {
  assert.ok((await call(MX, "POST", "payments", { business_id: bizX, gross_amount: 5, amount: 5, status: "paid" })).ok, "관리자 매출 등록");
  assert.ok((await call(SX, "POST", "customers", { business_id: bizX, name: "직원등록" })).ok, "직원 고객 등록");
  assert.deepEqual((await call(SX, "GET", `payments?business_id=eq.${bizX}`)).json, [], "직원 매출 조회 불가(007)");
  assert.ok(blocked(await call(SX, "DELETE", `customers?id=eq.${ids.custX2}`)), "직원 고객 삭제 불가(007)");
  assert.ok(blocked(await call(MX, "POST", "marketing_messages", { business_id: bizX, target_description: "x", message: "x" })), "관리자 마케팅 불가(007)");
  assert.equal((await svc("GET", `customers?id=eq.${ids.custX2}&select=id`)).length, 1);
});

test("체험 종료 후: 로그인 허용 + 조회/내보내기용 조회 허용 (대표·관리자·직원)", async () => {
  await expireX();
  for (const u of [OX, MX, SX]) assert.ok(await login(u.email), "체험 종료 후에도 로그인 가능");
  const fresh = async (u) => ({ ...u, token: await login(u.email) });
  const [o, m, s] = [await fresh(OX), await fresh(MX), await fresh(SX)];
  for (const tbl of ["customers", "reservations", "consultations", "payments", "staff", "services", "payment_methods"]) {
    const r = await call(o, "GET", `${tbl}?business_id=eq.${bizX}&select=*`);
    assert.ok(r.ok && r.rows >= 1, `대표 ${tbl} 조회: ${r.status}`);
  }
  assert.ok((await call(m, "GET", `payments?business_id=eq.${bizX}`)).rows >= 1, "관리자 매출 조회");
  for (const tbl of ["customers", "reservations", "consultations"]) assert.ok((await call(s, "GET", `${tbl}?business_id=eq.${bizX}`)).rows >= 1, `직원 ${tbl} 조회`);
  assert.deepEqual((await call(s, "GET", `payments?business_id=eq.${bizX}`)).json, [], "직원 매출 조회는 체험 종료와 무관하게 007 로 계속 차단");
  assert.equal((await call(o, "GET", `businesses?id=eq.${bizX}&select=id`)).rows, 1);
  // Export 는 이 조회를 그대로 사용한다: 관계 조인 조회도 가능해야 함
  assert.ok((await call(o, "GET", `reservations?business_id=eq.${bizX}&select=*,customer:customers(name),staff:staff(name),service:services(name)`)).ok);
  // 저장된 상태는 아직 trial 이어도 DB 는 시각으로 판단: 쓰기 차단이 이미 동작 (아래 테스트)
  assert.equal((await mySub(o, bizX)).status, "trial", "저장값은 아직 trial (시각 기준으로만 차단)");
});

test("체험 종료 후: 대표 — 고객/예약/상담/매출/설정 등록·수정·삭제 API 직접 호출 전부 차단, 데이터 그대로", async () => {
  const o = OX;
  const start = new Date(Date.now() + 172_800_000).toISOString(), end = new Date(Date.now() + 176_400_000).toISOString();
  const attempts = [
    ["고객 등록", "POST", "customers", { business_id: bizX, name: "만료후고객" }],
    ["고객 수정", "PATCH", `customers?id=eq.${ids.custX}`, { memo: "변조" }],
    ["고객 삭제", "DELETE", `customers?id=eq.${ids.custX2}`],
    ["예약 등록", "POST", "reservations", { business_id: bizX, customer_id: ids.custX, start_time: start, end_time: end }],
    ["예약 수정", "PATCH", `reservations?id=eq.${ids.resX}`, { memo: "변조" }],
    ["예약 삭제", "DELETE", `reservations?id=eq.${ids.resX}`],
    ["상담 등록", "POST", "consultations", { business_id: bizX, customer_id: ids.custX, content: "만료후상담" }],
    ["상담 수정", "PATCH", `consultations?id=eq.${ids.consX}`, { content: "변조" }],
    ["상담 삭제", "DELETE", `consultations?id=eq.${ids.consX}`],
    ["매출 등록", "POST", "payments", { business_id: bizX, gross_amount: 9, amount: 9, status: "paid" }],
    ["매출 수정", "PATCH", `payments?id=eq.${ids.payX}`, { amount: 1 }],
    ["매출 삭제", "DELETE", `payments?id=eq.${ids.payX}`],
    ["결제수단 추가", "POST", "payment_methods", { business_id: bizX, name: "만료후" }],
    ["결제수단 삭제", "DELETE", `payment_methods?id=eq.${ids.pmX}`],
    ["시술 추가", "POST", "services", { business_id: bizX, name: "만료후메뉴" }],
    ["시술 수정", "PATCH", `services?id=eq.${ids.svcX}`, { price: 1 }],
    ["담당자 추가", "POST", "staff", { business_id: bizX, name: "만료후직원", role: "staff" }],
    ["담당자 수정", "PATCH", `staff?id=eq.${ids.stLabel}`, { name: "변조" }],
    ["담당자 삭제", "DELETE", `staff?id=eq.${ids.stLabel}`],
    ["예약그룹 추가", "POST", "reservation_groups", { business_id: bizX, name: "만료후그룹" }],
    ["고객태그 추가", "POST", "customer_tags", { business_id: bizX, name: "만료후태그" }],
    ["매장 설정 변경", "PATCH", `businesses?id=eq.${bizX}`, { name: "만료후변경", phone: "1" }],
    ["대표자명 변경", "PATCH", `businesses?id=eq.${bizX}`, { representative_name: "변조" }],
    ["알림 설정 변경", "PATCH", `notification_settings?business_id=eq.${bizX}`, { channel: "kakao" }],
    ["마케팅 기록 생성", "POST", "marketing_messages", { business_id: bizX, target_description: "x", message: "만료후" }],
  ];
  const leaked = [];
  for (const [label, m, pq, body] of attempts) if (!blocked(await call(o, m, pq, body))) leaked.push(label);
  assert.deepEqual(leaked, [], `차단되지 않은 작업: ${leaked.join(", ")}`);

  // 데이터가 실제로 그대로인지 service_role 로 확인
  assert.equal((await svc("GET", `customers?id=eq.${ids.custX}&select=memo`))[0].memo, "원본");
  assert.equal((await svc("GET", `customers?id=eq.${ids.custX2}&select=id`)).length, 1);
  assert.equal((await svc("GET", `reservations?id=eq.${ids.resX}&select=memo`))[0].memo, "원본");
  assert.equal((await svc("GET", `consultations?id=eq.${ids.consX}&select=content`))[0].content, "원본");
  assert.equal((await svc("GET", `payments?id=eq.${ids.payX}&select=amount`))[0].amount, 1000);
  assert.equal((await svc("GET", `services?id=eq.${ids.svcX}&select=price`))[0].price, 10000);
  assert.equal((await svc("GET", `staff?id=eq.${ids.stLabel}&select=name`))[0].name, "라벨직원");
  const [b] = await svc("GET", `businesses?id=eq.${bizX}&select=name,representative_name`);
  assert.equal(b.name, `X-${run}`); assert.equal(b.representative_name, "대표");
  assert.equal((await svc("GET", `customers?business_id=eq.${bizX}&name=eq.${encodeURIComponent("만료후고객")}&select=id`)).length, 0);
  assert.equal((await svc("GET", `marketing_messages?business_id=eq.${bizX}&select=id`)).length, 0);
});

test("체험 종료 후: 관리자·직원도 동일하게 쓰기 차단 (007 권한 위에 구독 검사가 덧씌워짐)", async () => {
  const m = MX, s = SX;
  const start = new Date(Date.now() + 172_800_000).toISOString(), end = new Date(Date.now() + 176_400_000).toISOString();
  assert.ok(blocked(await call(m, "POST", "payments", { business_id: bizX, gross_amount: 7, amount: 7, status: "paid" })), "관리자 매출 등록");
  assert.ok(blocked(await call(m, "DELETE", `customers?id=eq.${ids.custX2}`)), "관리자 고객 삭제");
  assert.ok(blocked(await call(m, "POST", "services", { business_id: bizX, name: "관리자메뉴" })), "관리자 시술 추가");
  assert.ok(blocked(await call(m, "POST", "staff", { business_id: bizX, name: "관리자추가", role: "staff" })), "관리자 담당자 추가");
  assert.ok(blocked(await call(s, "POST", "customers", { business_id: bizX, name: "직원만료후고객" })), "직원 고객 등록");
  assert.ok(blocked(await call(s, "PATCH", `customers?id=eq.${ids.custX}`, { memo: "직원변조" })), "직원 고객 수정");
  assert.ok(blocked(await call(s, "POST", "reservations", { business_id: bizX, start_time: start, end_time: end })), "직원 예약 등록");
  assert.ok(blocked(await call(s, "PATCH", `reservations?id=eq.${ids.resX}`, { status: "completed" })), "직원 예약 수정");
  assert.ok(blocked(await call(s, "POST", "consultations", { business_id: bizX, customer_id: ids.custX, content: "직원상담" })), "직원 상담 등록");
  assert.ok(blocked(await call(s, "PATCH", `consultations?id=eq.${ids.consX}`, { result: "상담완료" })), "직원 상담 수정");
  assert.equal((await svc("GET", `reservations?id=eq.${ids.resX}&select=status`))[0].status, "confirmed");
  // 계정 자체 정보(이름/전화번호) 수정은 사업장 구독과 무관하게 허용
  assert.ok((await call(s, "PATCH", `profiles?id=eq.${SX.id}`, { full_name: "직원새이름" })).ok);
});

test("체험 종료 후: 함수 경로(초대 생성/직급 변경)도 차단, 보안 조치(초대 취소/연결 해제)는 허용", async () => {
  const o = OX;
  const inv = await call(o, "POST", "rpc/create_staff_invitation", { p_staff_id: ids.stLabel, p_email: `x-${run}@gmail.com`, p_token_hash: crypto.randomBytes(32).toString("hex") });
  assert.ok(!inv.ok); assert.match(inv.message, /subscription_inactive/);
  const role = await call(o, "POST", "rpc/set_member_role", { p_staff_id: ids.stS, p_role: "manager" });
  assert.ok(!role.ok); assert.match(role.message, /subscription_inactive/);
  assert.equal((await svc("GET", `profiles?id=eq.${SX.id}&select=role`))[0].role, "staff");
  assert.ok((await call(o, "POST", "rpc/revoke_staff_invitation", { p_staff_id: ids.stLabel })).ok, "초대 취소는 허용");
  // 연결 해제(접근 회수)는 만료 후에도 가능해야 한다
  const extra = await mkUser("sx2");
  await svc("PATCH", `profiles?id=eq.${extra.id}`, { business_id: bizX, role: "staff" });
  const stExtra = (await svc("POST", "staff", { business_id: bizX, name: "연결직원", role: "staff", profile_id: extra.id }))[0].id;
  const un = await call(o, "POST", "rpc/unlink_staff_account", { p_staff_id: stExtra });
  assert.ok(un.ok, `연결 해제 ${un.status} ${JSON.stringify(un.json)}`);
  assert.equal((await svc("GET", `profiles?id=eq.${extra.id}&select=business_id`))[0].business_id, null);
});

test("체험 종료 후: 사업자번호 재등록/새 사업장 생성으로 우회 불가", async () => {
  const o = OX;
  const again = await call(o, "POST", "rpc/set_business_number", { p_hash: hashOf("7777777777"), p_masked: "***" });
  assert.ok(!again.ok); assert.equal(again.code, "23505");
  const second = await createBiz(o, `X2-${run}`, "8888888888");
  assert.ok(!second.ok); assert.equal(second.code, "23505");
});

test("sync: 로그인 시 만료 반영 → 저장 상태 expired, 이력 ended (DB 시각 기준)", async () => {
  const o = OX;
  assert.ok((await call(o, "POST", "rpc/sync_my_subscription", {})).ok);
  assert.equal((await mySub(o, bizX)).status, "expired");
  const [h] = await svc("GET", `trial_history?business_id=eq.${bizX}&select=status`);
  assert.equal(h.status, "ended");
});

test("유료 구독 상태(결제 연동 시 service_role 이 설정) 별 쓰기 가능 여부: active 허용 / suspended·canceled(기간 없음) 차단 / canceled(기간 남음) 허용", async () => {
  const o = OX;
  const add = (name) => call(o, "POST", "customers", { business_id: bizX, name });
  await svc("PATCH", `subscriptions?business_id=eq.${bizX}`, { status: "active", plan: "basic", billing_cycle: "monthly", current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  assert.ok((await add("유료고객")).ok, "active");
  await svc("PATCH", `subscriptions?business_id=eq.${bizX}`, { status: "suspended", suspended_at: new Date().toISOString(), suspended_reason: "시험" });
  assert.ok(blocked(await add("정지고객")), "suspended");
  assert.ok((await call(o, "GET", `customers?business_id=eq.${bizX}`)).ok, "정지 상태에서도 조회 허용");
  await svc("PATCH", `subscriptions?business_id=eq.${bizX}`, { status: "canceled", canceled_at: new Date().toISOString(), current_period_end: null });
  assert.ok(blocked(await add("취소고객")), "canceled(기간 없음)");
  await svc("PATCH", `subscriptions?business_id=eq.${bizX}`, { current_period_end: new Date(Date.now() + 5 * 86_400_000).toISOString() });
  assert.ok((await add("취소전고객")).ok, "canceled(기간 남음)");
});

// ══════════════════════════════════════════════════════════════════════
// 사업장 격리 (기존과 동일하게 재검증): X(만료/정지) 와 Y(체험 중)
// ══════════════════════════════════════════════════════════════════════
test("격리: 만료된 X 는 Y 데이터를 못 보고 못 쓴다 / Y 는 체험 중이라 쓰기 가능하며 X 데이터를 못 본다", async () => {
  await svc("PATCH", `subscriptions?business_id=eq.${bizX}`, { status: "expired", current_period_end: null });
  const o = OX;
  assert.deepEqual((await call(o, "GET", `customers?business_id=eq.${bizY}`)).json, []);
  assert.ok(blocked(await call(o, "PATCH", `customers?id=eq.${ids.custY}`, { name: "해킹" })));
  assert.ok(blocked(await call(o, "POST", "customers", { business_id: bizY, name: "침입" })));
  assert.equal((await svc("GET", `customers?id=eq.${ids.custY}&select=name`))[0].name, "Y고객");
  const y = OY;
  assert.ok((await call(y, "POST", "customers", { business_id: bizY, name: "Y신규" })).ok, "Y 는 체험 중이라 등록 가능");
  assert.deepEqual((await call(y, "GET", `customers?business_id=eq.${bizX}`)).json, []);
  assert.ok(blocked(await call(y, "PATCH", `customers?id=eq.${ids.custX}`, { memo: "Y가변조" })));
  assert.deepEqual((await call(y, "GET", `subscriptions?business_id=eq.${bizX}`)).json, [], "다른 사업장의 구독 상태는 볼 수 없음");
  assert.equal((await svc("GET", `customers?id=eq.${ids.custX}&select=memo`))[0].memo, "원본");
});

// ══════════════════════════════════════════════════════════════════════
// 기존 사업장 사업자번호 사후 등록
// ══════════════════════════════════════════════════════════════════════
test("기존(백필) 사업장: 사업자번호 사후 등록 — 대표만, 중복 번호 거부, 1회만", async () => {
  const L = await mkUser("legacy");
  const biz = (await svc("POST", "businesses", { owner_id: L.id, name: `기존-${run}` }))[0].id;
  await svc("PATCH", `profiles?id=eq.${L.id}`, { business_id: biz, role: "owner" });
  await svc("POST", "subscriptions", { business_id: biz, status: "trial", trial_source: "legacy_backfill", trial_started_at: new Date().toISOString(), trial_ends_at: new Date(Date.now() + 90 * 86_400_000).toISOString() });
  await svc("POST", "trial_history", { business_id: biz, source: "legacy_backfill", trial_started_at: new Date().toISOString(), trial_ends_at: new Date(Date.now() + 90 * 86_400_000).toISOString() });
  const used = await call(L, "POST", "rpc/set_business_number", { p_hash: hashOf(NUM_D), p_masked: "***" });
  assert.ok(!used.ok); assert.equal(used.code, "23505");
  const ok = await call(L, "POST", "rpc/set_business_number", { p_hash: hashOf("9999999999"), p_masked: "999-**-***99" });
  assert.ok(ok.ok, `${ok.status} ${JSON.stringify(ok.json)}`);
  assert.equal((await svc("GET", `trial_history?business_id=eq.${biz}&select=business_number_hash`))[0].business_number_hash, hashOf("9999999999"));
  assert.ok(!(await call(L, "POST", "rpc/set_business_number", { p_hash: hashOf("1010101010"), p_masked: "***" })).ok, "한 번 등록하면 변경 불가");
  // 이 번호로 새 계정이 가입하면 체험 거부 (이력에 반영됨)
  const N = await mkUser("legacy-dup");
  const r = await createBiz(N, `기존중복-${run}`, "9999999999");
  assert.equal((await mySub(N, r.json)).status, "expired");
});

after(async () => {
  for (const id of created) await admin("DELETE", `/${id}`);
});

// 직급별 접근 제어(007) 공격/정상 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 실제 Supabase Auth 로 로그인한 JWT 로 PostgREST 를 직접 호출한다 (화면·서버 액션을 우회하는 공격 경로).
// 차단 판정: HTTP 4xx 이거나, 변경/삭제가 0행에 그치고 "service_role 로 확인한 실제 데이터가 그대로"일 때.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTarget, mintUserToken } from "../../scripts/lib/env.mjs";

const t = loadTarget("test");
const run = crypto.randomBytes(3).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const SH = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };
const created = [];

const admin = async (method, p, body) => {
  const r = await fetch(`${t.url}/auth/v1/admin/users${p}`, { method, headers: SH, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  assert.ok(r.ok, `auth admin ${method} ${p}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};
async function mkUser(label) {
  const email = `rba-${run}-${label}@gmail.com`;
  const u = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: `T-${label}` } });
  created.push(u.id);
  // 로그인 요청 한도(429)를 피하려고 테스트 프로젝트 서명 키로 토큰을 발급한다. 로그인 자체가 필요한 검사는 실제 로그인을 쓴다.
  const token = (await mintUserToken(t, { id: u.id, email })) ?? (await (await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) })).json()).access_token;
  return { id: u.id, token };
}
const call = async (u, method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { apikey: t.anonKey, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, ok: r.ok, json, rows: Array.isArray(json) ? json.length : null, code: json?.code };
};
const svc = async (method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { ...SH, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  assert.ok(r.ok, `svc ${method} ${pq}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
};
// 차단: 4xx 이거나 (2xx 인데 영향 행 0)
const blocked = (r) => !r.ok || r.rows === 0;

let O, M, S, Y, bizA, bizB, ids = {};

before(async () => {
  [O, M, S, Y] = await Promise.all([mkUser("owner"), mkUser("manager"), mkUser("staff"), mkUser("yowner")]);
  const rpc = async (u, name) => (await (await fetch(`${t.url}/rest/v1/rpc/create_my_business`, { method: "POST", headers: { apikey: t.anonKey, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_name: name, p_business_number_hash: crypto.randomBytes(32).toString("hex") }) })).json());
  bizA = await rpc(O, `RBA-A-${run}`);
  bizB = await rpc(Y, `RBA-B-${run}`);
  await svc("PATCH", `profiles?id=eq.${M.id}`, { business_id: bizA, role: "manager" });
  await svc("PATCH", `profiles?id=eq.${S.id}`, { business_id: bizA, role: "staff" });
  const [stM] = await svc("POST", "staff", { business_id: bizA, profile_id: M.id, name: "관리자", role: "manager" });
  const [stS] = await svc("POST", "staff", { business_id: bizA, profile_id: S.id, name: "직원", role: "staff" });
  const [stL] = await svc("POST", "staff", { business_id: bizA, name: "라벨직원", role: "staff" });
  ids.stM = stM.id; ids.stS = stS.id; ids.stL = stL.id;
  ids.stOwner = (await svc("GET", `staff?business_id=eq.${bizA}&role=eq.owner&select=id`))[0].id;

  // 삭제/변경 시도 대상: 행위자별로 분리해서 서로 영향이 없도록 한다
  const mkCustomer = async (b, name) => (await svc("POST", "customers", { business_id: b, name, phone: "010-0000-0000" }))[0].id;
  ids.cust = await mkCustomer(bizA, "직원삭제시도"); ids.custMgr = await mkCustomer(bizA, "관리자삭제"); ids.custB = await mkCustomer(bizB, "B고객");
  const start = new Date(Date.now() + 86_400_000).toISOString(), end = new Date(Date.now() + 90_000_000).toISOString();
  const mkRes = async (b, c) => (await svc("POST", "reservations", { business_id: b, customer_id: c, start_time: start, end_time: end, status: "confirmed" }))[0].id;
  ids.res = await mkRes(bizA, ids.cust); ids.resMgr = await mkRes(bizA, ids.cust); ids.resB = await mkRes(bizB, ids.custB);
  const mkCons = async (b, c) => (await svc("POST", "consultations", { business_id: b, customer_id: c, content: "원본" }))[0].id;
  ids.cons = await mkCons(bizA, ids.cust); ids.consMgr = await mkCons(bizA, ids.cust); ids.consB = await mkCons(bizB, ids.custB);
  const mkPay = async (b) => (await svc("POST", "payments", { business_id: b, gross_amount: 1000, amount: 1000, status: "paid" }))[0].id;
  ids.pay = await mkPay(bizA); ids.payB = await mkPay(bizB);
  ids.pm = (await svc("GET", `payment_methods?business_id=eq.${bizA}&select=id&limit=1`))[0].id;
  ids.svcRow = (await svc("POST", "services", { business_id: bizA, name: "커트", price: 10000 }))[0].id;
  ids.grp = (await svc("POST", "reservation_groups", { business_id: bizA, name: "그룹" }))[0].id;
  ids.tag = (await svc("POST", "customer_tags", { business_id: bizA, name: "태그" }))[0].id;
  await svc("POST", "marketing_messages", { business_id: bizA, target_description: "전체", message: "원본" });
});

after(async () => {
  for (const id of created) await fetch(`${t.url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: SH });
});

// ── 직원: 삭제 기능 ──────────────────────────────────────────────────
test("직원 → 고객 삭제 차단 (데이터 그대로)", async () => {
  assert.ok(blocked(await call(S, "DELETE", `customers?id=eq.${ids.cust}`)));
  assert.equal((await svc("GET", `customers?id=eq.${ids.cust}&select=id`)).length, 1);
});
test("직원 → 예약 삭제 차단", async () => {
  assert.ok(blocked(await call(S, "DELETE", `reservations?id=eq.${ids.res}`)));
  assert.equal((await svc("GET", `reservations?id=eq.${ids.res}&select=id`)).length, 1);
});
test("직원 → 상담 삭제 차단", async () => {
  assert.ok(blocked(await call(S, "DELETE", `consultations?id=eq.${ids.cons}`)));
  assert.equal((await svc("GET", `consultations?id=eq.${ids.cons}&select=id`)).length, 1);
});
test("직원 → 매출 조회/등록/수정/삭제 모두 차단", async () => {
  const sel = await call(S, "GET", `payments?business_id=eq.${bizA}`);
  assert.deepEqual(sel.json, [], "직원이 매출을 조회할 수 있음");
  assert.ok(blocked(await call(S, "POST", "payments", { business_id: bizA, gross_amount: 1, amount: 1, status: "paid" })));
  assert.ok(blocked(await call(S, "PATCH", `payments?id=eq.${ids.pay}`, { amount: 1 })));
  assert.ok(blocked(await call(S, "DELETE", `payments?id=eq.${ids.pay}`)));
  const [p] = await svc("GET", `payments?id=eq.${ids.pay}&select=amount`);
  assert.equal(p.amount, 1000, "매출이 변경됨");
  assert.equal((await svc("GET", `payments?business_id=eq.${bizA}&select=id`)).length, 1, "직원이 매출을 새로 만듦");
});
test("직원 → 담당자 추가/수정/삭제 차단 (대표 행 포함)", async () => {
  assert.ok(blocked(await call(S, "POST", "staff", { business_id: bizA, name: "직원이만듦", role: "staff" })));
  assert.ok(blocked(await call(S, "PATCH", `staff?id=eq.${ids.stL}`, { name: "해킹" })));
  assert.ok(blocked(await call(S, "DELETE", `staff?id=eq.${ids.stL}`)));
  assert.ok(blocked(await call(S, "DELETE", `staff?id=eq.${ids.stOwner}`)));
  const rows = await svc("GET", `staff?business_id=eq.${bizA}&select=id,name`);
  assert.equal(rows.length, 4);
  assert.ok(rows.some((r) => r.id === ids.stL && r.name === "라벨직원"));
});
test("직원 → 결제수단 조회/추가/수정/삭제 차단", async () => {
  assert.deepEqual((await call(S, "GET", `payment_methods?business_id=eq.${bizA}`)).json, []);
  assert.ok(blocked(await call(S, "POST", "payment_methods", { business_id: bizA, name: "직원이만듦" })));
  assert.ok(blocked(await call(S, "PATCH", `payment_methods?id=eq.${ids.pm}`, { name: "해킹" })));
  assert.ok(blocked(await call(S, "DELETE", `payment_methods?id=eq.${ids.pm}`)));
  const rows = await svc("GET", `payment_methods?business_id=eq.${bizA}&select=id,name`);
  assert.equal(rows.length, 3);
  assert.ok(!rows.some((r) => r.name === "해킹" || r.name === "직원이만듦"));
});
test("직원 → 알림 설정 조회/변경 차단", async () => {
  assert.deepEqual((await call(S, "GET", `notification_settings?business_id=eq.${bizA}`)).json, []);
  assert.ok(blocked(await call(S, "PATCH", `notification_settings?business_id=eq.${bizA}`, { channel: "kakao" })));
  assert.equal((await svc("GET", `notification_settings?business_id=eq.${bizA}&select=channel`))[0].channel, "sms");
});
test("직원 → 마케팅 발송 기록 조회/생성/수정/삭제 차단", async () => {
  assert.deepEqual((await call(S, "GET", `marketing_messages?business_id=eq.${bizA}`)).json, []);
  assert.ok(blocked(await call(S, "POST", "marketing_messages", { business_id: bizA, target_description: "x", message: "스팸" })));
  assert.ok(blocked(await call(S, "PATCH", `marketing_messages?business_id=eq.${bizA}`, { message: "변조" })));
  assert.ok(blocked(await call(S, "DELETE", `marketing_messages?business_id=eq.${bizA}`)));
  const rows = await svc("GET", `marketing_messages?business_id=eq.${bizA}&select=message`);
  assert.deepEqual(rows.map((r) => r.message), ["원본"]);
});
test("직원 → 시술/예약그룹/고객태그 등 분류 관리 차단 (조회는 가능)", async () => {
  assert.equal((await call(S, "GET", `services?business_id=eq.${bizA}`)).rows, 1);
  assert.ok(blocked(await call(S, "POST", "services", { business_id: bizA, name: "직원이추가" })));
  assert.ok(blocked(await call(S, "PATCH", `services?id=eq.${ids.svcRow}`, { price: 1 })));
  assert.ok(blocked(await call(S, "DELETE", `services?id=eq.${ids.svcRow}`)));
  assert.ok(blocked(await call(S, "DELETE", `reservation_groups?id=eq.${ids.grp}`)));
  assert.ok(blocked(await call(S, "POST", "customer_tags", { business_id: bizA, name: "직원이추가" })));
  assert.equal((await svc("GET", `services?id=eq.${ids.svcRow}&select=price`))[0].price, 10000);
});

// ── 직원: 사업장 정보 / 권한 상승 ─────────────────────────────────────
test("직원 → 사업장 정보 변경 차단", async () => {
  assert.ok(blocked(await call(S, "PATCH", `businesses?id=eq.${bizA}`, { name: "해킹", phone: "1" })));
  assert.equal((await svc("GET", `businesses?id=eq.${bizA}&select=name`))[0].name, `RBA-A-${run}`);
});
test("직원 → owner/admin 권한 상승 시도 모두 차단", async () => {
  const before_ = (await svc("GET", `profiles?id=eq.${S.id}&select=role,business_id`))[0];
  assert.ok(blocked(await call(S, "PATCH", `profiles?id=eq.${S.id}`, { role: "owner" })), "role=owner");
  assert.ok(blocked(await call(S, "PATCH", `profiles?id=eq.${S.id}`, { role: "manager" })), "role=manager");
  assert.ok(blocked(await call(S, "PATCH", `profiles?id=eq.${S.id}`, { business_id: bizB })), "business_id 이동");
  assert.ok(blocked(await call(S, "PATCH", `profiles?id=eq.${M.id}`, { role: "staff" })), "다른 사람 프로필 변경");
  assert.ok(blocked(await call(S, "POST", "rpc/set_member_role", { p_staff_id: ids.stS, p_role: "manager" })), "직급 변경 함수");
  assert.ok(blocked(await call(S, "PATCH", `staff?id=eq.${ids.stS}`, { role: "owner" })), "staff 행 role=owner");
  assert.ok(blocked(await call(S, "POST", "staff", { business_id: bizA, name: "가짜대표", role: "owner" })), "owner 담당자 생성");
  assert.deepEqual((await svc("GET", `profiles?id=eq.${S.id}&select=role,business_id`))[0], before_);
});

// ── 직원: 다른 사업장 ────────────────────────────────────────────────
test("직원 → 다른 사업장(B) 데이터 조회/수정/삭제/생성 차단", async () => {
  for (const tbl of ["customers", "reservations", "consultations", "payments", "staff"]) {
    assert.deepEqual((await call(S, "GET", `${tbl}?business_id=eq.${bizB}`)).json, [], `${tbl} 조회 유출`);
  }
  assert.ok(blocked(await call(S, "PATCH", `customers?id=eq.${ids.custB}`, { name: "해킹" })));
  assert.ok(blocked(await call(S, "DELETE", `reservations?id=eq.${ids.resB}`)));
  assert.ok(blocked(await call(S, "PATCH", `consultations?id=eq.${ids.consB}`, { content: "해킹" })));
  assert.ok(blocked(await call(S, "POST", "customers", { business_id: bizB, name: "침입" })));
  assert.ok(blocked(await call(S, "POST", "reservations", { business_id: bizB, start_time: new Date().toISOString(), end_time: new Date().toISOString() })));
  assert.equal((await svc("GET", `customers?id=eq.${ids.custB}&select=name`))[0].name, "B고객");
  assert.equal((await svc("GET", `reservations?id=eq.${ids.resB}&select=id`)).length, 1);
});

// ── 직원: 정상 기능 ──────────────────────────────────────────────────
test("직원 정상 기능: 고객 조회/등록/수정 + 태그 연결", async () => {
  assert.ok((await call(S, "GET", `customers?business_id=eq.${bizA}`)).rows >= 1);
  const c = await call(S, "POST", "customers", { business_id: bizA, name: "직원등록고객", phone: "010-1111-1111" });
  assert.ok(c.ok, `등록 ${c.status}`);
  const id = c.json[0].id;
  const u = await call(S, "PATCH", `customers?id=eq.${id}`, { memo: "직원이수정" });
  assert.ok(u.ok && u.rows === 1);
  const link = await call(S, "POST", "customer_tag_links", { business_id: bizA, customer_id: id, tag_id: ids.tag });
  assert.ok(link.ok, `태그 연결 ${link.status}`);
  assert.ok((await call(S, "DELETE", `customer_tag_links?customer_id=eq.${id}`)).ok, "태그 연결 해제(고객 수정의 일부)");
});
test("직원 정상 기능: 예약 조회/등록/수정", async () => {
  assert.ok((await call(S, "GET", `reservations?business_id=eq.${bizA}&select=*,customer:customers(name),staff:staff(name),service:services(name)`)).rows >= 1);
  const start = new Date(Date.now() + 172_800_000).toISOString(), end = new Date(Date.now() + 176_400_000).toISOString();
  const r = await call(S, "POST", "reservations", { business_id: bizA, customer_id: ids.cust, staff_id: ids.stM, service_id: ids.svcRow, start_time: start, end_time: end, status: "pending", source: "internal" });
  assert.ok(r.ok, `등록 ${r.status} ${JSON.stringify(r.json)}`);
  const u = await call(S, "PATCH", `reservations?id=eq.${r.json[0].id}`, { status: "confirmed", content: "직원수정" });
  assert.ok(u.ok && u.rows === 1);
});
test("직원 정상 기능: 상담 조회/등록/수정", async () => {
  const c = await call(S, "POST", "consultations", { business_id: bizA, customer_id: ids.cust, content: "직원상담", result: "상담중" });
  assert.ok(c.ok, `등록 ${c.status}`);
  const u = await call(S, "PATCH", `consultations?id=eq.${c.json[0].id}`, { result: "상담완료" });
  assert.ok(u.ok && u.rows === 1);
});
test("직원 정상 기능: 예약/상담 화면용 선택 목록(담당자·시술·그룹·타입·등급·태그) 조회, 자기 사업장 정보 조회", async () => {
  for (const tbl of ["staff", "services", "reservation_groups", "reservation_types", "consultation_types", "customer_grades", "customer_tags"]) {
    assert.ok((await call(S, "GET", `${tbl}?business_id=eq.${bizA}`)).ok, `${tbl} 조회`);
  }
  assert.ok((await call(S, "GET", `staff?business_id=eq.${bizA}`)).rows >= 3);
  assert.equal((await call(S, "GET", `businesses?id=eq.${bizA}&select=name`)).rows, 1);
  assert.ok((await call(S, "PATCH", `profiles?id=eq.${S.id}`, { full_name: "직원새이름" })).ok, "본인 이름 수정");
});

// ── 관리자 ───────────────────────────────────────────────────────────
test("관리자: 고객/예약/상담 삭제, 매출·결제수단·분류·담당자 관리 가능", async () => {
  assert.equal((await call(M, "DELETE", `customers?id=eq.${ids.custMgr}`)).rows, 1);
  assert.equal((await call(M, "DELETE", `reservations?id=eq.${ids.resMgr}`)).rows, 1);
  assert.equal((await call(M, "DELETE", `consultations?id=eq.${ids.consMgr}`)).rows, 1);
  assert.ok((await call(M, "GET", `payments?business_id=eq.${bizA}`)).rows >= 1);
  assert.ok((await call(M, "POST", "payments", { business_id: bizA, gross_amount: 5, amount: 5, status: "paid" })).ok);
  assert.ok((await call(M, "POST", "payment_methods", { business_id: bizA, name: "간편결제" })).ok);
  assert.ok((await call(M, "POST", "services", { business_id: bizA, name: "펌" })).ok);
  assert.ok((await call(M, "POST", "staff", { business_id: bizA, name: "신입", role: "staff" })).ok);
  assert.ok((await call(M, "PATCH", `staff?id=eq.${ids.stL}`, { title: "실장" })).ok);
});
test("관리자: 대표 전용 기능 차단 (알림설정·마케팅·사업장정보·직급변경·대표 삭제)", async () => {
  assert.deepEqual((await call(M, "GET", `notification_settings?business_id=eq.${bizA}`)).json, []);
  assert.ok(blocked(await call(M, "PATCH", `notification_settings?business_id=eq.${bizA}`, { channel: "kakao" })));
  assert.ok(blocked(await call(M, "POST", "marketing_messages", { business_id: bizA, target_description: "x", message: "x" })));
  assert.ok(blocked(await call(M, "PATCH", `businesses?id=eq.${bizA}`, { name: "해킹" })));
  assert.ok(blocked(await call(M, "POST", "rpc/set_member_role", { p_staff_id: ids.stS, p_role: "manager" })));
  assert.ok(blocked(await call(M, "PATCH", `staff?id=eq.${ids.stS}`, { role: "manager" })), "연결된 직원의 직급을 직접 수정");
  assert.ok(blocked(await call(M, "DELETE", `staff?id=eq.${ids.stOwner}`)));
  assert.ok(blocked(await call(M, "PATCH", `profiles?id=eq.${M.id}`, { role: "owner" })), "자기 승격");
  assert.equal((await svc("GET", `profiles?id=eq.${S.id}&select=role`))[0].role, "staff");
});
test("관리자 → 다른 사업장(B) 접근 차단", async () => {
  assert.ok(blocked(await call(M, "DELETE", `customers?id=eq.${ids.custB}`)));
  assert.deepEqual((await call(M, "GET", `payments?business_id=eq.${bizB}`)).json, []);
});

// ── 대표 ─────────────────────────────────────────────────────────────
test("대표: 전체 관리 가능, 다른 사업장은 불가", async () => {
  assert.ok((await call(O, "PATCH", `notification_settings?business_id=eq.${bizA}`, { channel: "kakao" })).ok);
  assert.ok((await call(O, "POST", "marketing_messages", { business_id: bizA, target_description: "전체", message: "공지" })).ok);
  assert.ok((await call(O, "PATCH", `businesses?id=eq.${bizA}`, { name: `RBA-A-${run}-수정` })).ok);
  assert.ok((await call(O, "POST", "rpc/set_member_role", { p_staff_id: ids.stS, p_role: "manager" })).ok);
  assert.equal((await svc("GET", `profiles?id=eq.${S.id}&select=role`))[0].role, "manager", "대표가 바꾼 직급이 계정에도 반영");
  assert.ok((await call(O, "POST", "rpc/set_member_role", { p_staff_id: ids.stS, p_role: "staff" })).ok);
  assert.ok(blocked(await call(O, "DELETE", `staff?id=eq.${ids.stOwner}`)), "대표 본인 담당자 행 삭제 불가");
  assert.ok(blocked(await call(O, "DELETE", `customers?id=eq.${ids.custB}`)));
  assert.ok(blocked(await call(O, "PATCH", `businesses?id=eq.${bizB}`, { name: "해킹" })));
});

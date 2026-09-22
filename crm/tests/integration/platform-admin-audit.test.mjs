// 플랫폼 관리자 + 감사 로그(010) 통합 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 실제 Auth JWT 로 PostgREST/RPC 를 직접 호출한다 (화면·서버 액션을 우회하는 공격 경로와 같음).
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

// 테스트가 일부러 넣는 "개인정보" 표식: 로그 어디에도 나타나면 안 된다
const PII = { custName: `민감고객${run}`, custPhone: "010-7777-8888", memo: `비밀메모${run}`, email: `pii-${run}@gmail.com`, msg: `비밀공지${run}`, target: `비밀대상${run}` };

const admin = async (method, p, body) => {
  const r = await fetch(`${t.url}/auth/v1/admin/users${p}`, { method, headers: SH, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { ok: r.ok, json: text ? JSON.parse(text) : {} };
};
async function mkUser(label) {
  const email = `pal-${run}-${label}@gmail.com`;
  const r = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: `T-${label}` } });
  assert.ok(r.ok, `create ${label}`);
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
const serverLog = (over) => rpc({ token: t.serviceKey }, "audit_log_server", { p_business: null, p_actor_user: null, p_actor_type: "system", p_action: "auth.login", p_resource_type: "auth", p_resource_id: null, p_result: "success", p_metadata: {}, p_ip: null, p_ua: null, ...over });
const blocked = (r) => !r.ok || r.rows === 0;
const logs = (q) => svc("GET", `audit_logs?${q}&order=seq.asc&select=*`);
const has = async (action, biz, actorType, resourceId, actorUser) =>
  (await logs(`action=eq.${action}&business_id=eq.${biz}&actor_type=eq.${actorType}${resourceId ? `&resource_id=eq.${resourceId}` : ""}${actorUser ? `&actor_user_id=eq.${actorUser}` : ""}`)).length;

let OA, MA, SA, OB, PA, U, bizA, bizB, ids = {};

before(async () => {
  [OA, MA, SA, OB, PA, U] = await Promise.all(["oa", "ma", "sa", "ob", "pa", "u"].map(mkUser));
  const create = async (u, name) => (await rpc(u, "create_my_business", { p_name: name, p_representative_name: `대표-${name}`, p_business_number_hash: hash(), p_business_number_masked: "111-**-***11" })).json;
  bizA = await create(OA, `감사시험A-${run}`);
  bizB = await create(OB, `감사시험B-${run}`);
  await svc("PATCH", `profiles?id=eq.${MA.id}`, { business_id: bizA, role: "manager" });
  await svc("PATCH", `profiles?id=eq.${SA.id}`, { business_id: bizA, role: "staff" });
  ids.stM = (await svc("POST", "staff", { business_id: bizA, profile_id: MA.id, name: "관리자", role: "manager" }))[0].id;
  ids.stS = (await svc("POST", "staff", { business_id: bizA, profile_id: SA.id, name: "직원", role: "staff" }))[0].id;
  ids.stLabel = (await svc("POST", "staff", { business_id: bizA, name: "라벨", role: "staff" }))[0].id;
  await svc("POST", "platform_admins", { user_id: PA.id });
});

after(async () => {
  for (const id of created) await admin("DELETE", `/${id}`);
});

// ══ 자동 감사 기록: 화면을 우회한 API 직접 호출도 기록된다 ═════════════════════
test("대표(A): 고객/예약/상담/매출 생성·수정·삭제가 로그에 기록된다 (actor=owner, resource_id, 값 없음)", async () => {
  const c = await call(OA, "POST", "customers", { business_id: bizA, name: PII.custName, phone: PII.custPhone, memo: PII.memo });
  assert.ok(c.ok, `${c.status} ${c.message}`);
  ids.cust = c.json[0].id;
  assert.ok((await call(OA, "PATCH", `customers?id=eq.${ids.cust}`, { memo: `${PII.memo}-수정`, phone: "010-1212-3434" })).ok);
  const start = new Date(Date.now() + 86_400_000).toISOString(), end = new Date(Date.now() + 90_000_000).toISOString();
  ids.res = (await call(OA, "POST", "reservations", { business_id: bizA, customer_id: ids.cust, start_time: start, end_time: end, status: "confirmed" })).json[0].id;
  assert.ok((await call(OA, "PATCH", `reservations?id=eq.${ids.res}`, { status: "completed" })).ok);
  ids.cons = (await call(OA, "POST", "consultations", { business_id: bizA, customer_id: ids.cust, content: PII.memo })).json[0].id;
  ids.pay = (await call(OA, "POST", "payments", { business_id: bizA, customer_id: ids.cust, gross_amount: 123000, amount: 123000, status: "paid" })).json[0].id;
  assert.ok((await call(OA, "PATCH", `payments?id=eq.${ids.pay}`, { amount: 100000 })).ok);
  assert.ok((await call(OA, "DELETE", `consultations?id=eq.${ids.cons}`)).ok);
  assert.ok((await call(OA, "DELETE", `reservations?id=eq.${ids.res}`)).ok);
  assert.ok((await call(OA, "DELETE", `payments?id=eq.${ids.pay}`)).ok);
  const c2 = (await call(OA, "POST", "customers", { business_id: bizA, name: `${PII.custName}-삭제` })).json[0].id;
  assert.ok((await call(OA, "DELETE", `customers?id=eq.${c2}`)).ok);

  for (const [action, resId] of [["customer.create", ids.cust], ["customer.update", ids.cust], ["reservation.create", ids.res], ["reservation.update", ids.res],
    ["reservation.delete", ids.res], ["consultation.create", ids.cons], ["consultation.delete", ids.cons], ["payment.create", ids.pay], ["payment.update", ids.pay],
    ["payment.delete", ids.pay], ["customer.delete", c2]]) {
    assert.equal(await has(action, bizA, "owner", resId, OA.id), 1, `${action} 로그 없음`);
  }
  const upd = (await logs(`action=eq.customer.update&resource_id=eq.${ids.cust}`))[0];
  assert.deepEqual(upd.metadata.changed_fields.sort(), ["memo", "phone"], "바뀐 컬럼 이름만 기록");
  const del = (await logs(`action=eq.customer.delete&resource_id=eq.${c2}`))[0];
  assert.deepEqual(del.metadata, {}, "삭제 로그에는 고객 정보가 없다");
});

test("직원(A): 허용된 작업이 actor=staff 로 기록되고, 차단된 삭제 시도는 로그도 데이터 변경도 없다", async () => {
  const start = new Date(Date.now() + 172_800_000).toISOString(), end = new Date(Date.now() + 176_400_000).toISOString();
  const r = await call(SA, "POST", "reservations", { business_id: bizA, customer_id: ids.cust, start_time: start, end_time: end });
  assert.ok(r.ok); ids.resS = r.json[0].id;
  assert.ok((await call(SA, "PATCH", `customers?id=eq.${ids.cust}`, { memo: "직원수정" })).ok);
  ids.consS = (await call(SA, "POST", "consultations", { business_id: bizA, customer_id: ids.cust, content: "직원상담" })).json[0].id;
  assert.equal(await has("reservation.create", bizA, "staff", ids.resS, SA.id), 1);
  assert.equal(await has("customer.update", bizA, "staff", ids.cust, SA.id), 1);
  assert.equal(await has("consultation.create", bizA, "staff", ids.consS, SA.id), 1);
  // 차단된 삭제 시도
  const before_ = (await logs(`action=eq.customer.delete&business_id=eq.${bizA}`)).length;
  assert.ok(blocked(await call(SA, "DELETE", `customers?id=eq.${ids.cust}`)));
  assert.equal((await svc("GET", `customers?id=eq.${ids.cust}&select=id`)).length, 1);
  assert.equal((await logs(`action=eq.customer.delete&business_id=eq.${bizA}`)).length, before_, "삭제되지 않았는데 삭제 로그가 생김");
});

test("관리자(A): 매출/결제수단/삭제 작업이 actor=admin 으로 기록된다", async () => {
  ids.payM = (await call(MA, "POST", "payments", { business_id: bizA, gross_amount: 5000, amount: 5000, status: "paid" })).json[0].id;
  assert.ok((await call(MA, "DELETE", `reservations?id=eq.${ids.resS}`)).ok);
  const pm = (await call(MA, "POST", "payment_methods", { business_id: bizA, name: "간편결제" })).json[0].id;
  assert.ok((await call(MA, "PATCH", `payment_methods?id=eq.${pm}`, { name: "간편결제2" })).ok);
  assert.ok((await call(MA, "DELETE", `payment_methods?id=eq.${pm}`)).ok);
  assert.ok((await call(MA, "PATCH", `staff?id=eq.${ids.stLabel}`, { title: "실장" })).ok);
  for (const [a, r] of [["payment.create", ids.payM], ["reservation.delete", ids.resS], ["payment_method.create", pm], ["payment_method.update", pm], ["payment_method.delete", pm], ["staff.update", ids.stLabel]]) {
    assert.equal(await has(a, bizA, "admin", r, MA.id), 1, `${a} (admin) 로그 없음`);
  }
});

test("설정·마케팅·직원 관리 기록: 사업장 설정 변경 / 알림설정 / 마케팅 / 초대 / 권한 변경 / 연결 해제", async () => {
  assert.ok((await call(OA, "PATCH", `businesses?id=eq.${bizA}`, { name: `감사시험A-${run}(수정)`, address: "부산" })).ok);
  assert.ok((await call(OA, "PATCH", `notification_settings?business_id=eq.${bizA}`, { channel: "kakao" })).ok);
  const mk = await call(OA, "POST", "marketing_messages", { business_id: bizA, target_description: PII.target, message: PII.msg, channel: "sms" });
  assert.ok(mk.ok); ids.mk = mk.json[0].id;
  assert.equal(await has("business.update", bizA, "owner", bizA, OA.id), 1);
  assert.deepEqual((await logs(`action=eq.business.update&resource_id=eq.${bizA}`))[0].metadata.changed_fields.sort(), ["address", "name"]);
  assert.equal(await has("notification_settings.update", bizA, "owner", null, OA.id), 1);
  assert.deepEqual((await logs(`action=eq.marketing.draft_create&resource_id=eq.${ids.mk}`))[0].metadata, { channel: "sms" }, "마케팅 내용/대상은 기록 안 함");

  const inv = await rpc(OA, "create_staff_invitation", { p_staff_id: ids.stLabel, p_email: PII.email, p_token_hash: hash() });
  assert.ok(inv.ok, `${inv.status} ${inv.message}`);
  assert.equal(await has("staff.invite", bizA, "owner", null, OA.id), 1);
  assert.deepEqual((await logs(`action=eq.staff.invite&business_id=eq.${bizA}`))[0].metadata, { invited_role: "staff" });
  assert.ok((await rpc(OA, "revoke_staff_invitation", { p_staff_id: ids.stLabel })).ok);
  assert.equal(await has("staff.invite_revoke", bizA, "owner", null, OA.id), 1);
  assert.ok((await rpc(OA, "set_member_role", { p_staff_id: ids.stS, p_role: "manager" })).ok);
  assert.ok((await rpc(OA, "set_member_role", { p_staff_id: ids.stS, p_role: "staff" })).ok);
  const rc = await logs(`action=eq.staff.role_change&business_id=eq.${bizA}`);
  assert.deepEqual(rc.map((l) => l.metadata), [{ role_from: "staff", role_to: "manager" }, { role_from: "manager", role_to: "staff" }]);
  assert.ok(rc.every((l) => l.actor_type === "owner" && l.resource_id === SA.id));
  assert.ok((await rpc(OA, "unlink_staff_account", { p_staff_id: ids.stS })).ok);
  assert.equal(await has("staff.unlink", bizA, "owner", SA.id, OA.id), 1);
});

test("무료체험/구독 기록: 사업장 생성·체험 시작 / 체험 종료 / 상태 변경", async () => {
  assert.equal(await has("business.create", bizA, "owner", bizA, OA.id), 1);
  assert.equal(await has("trial.start", bizA, "owner", null, OA.id), 1);
  assert.deepEqual((await logs(`action=eq.trial.start&business_id=eq.${bizA}`))[0].metadata, { trial_source: "signup" });
  assert.equal((await logs(`business_id=eq.${bizA}&action=in.(staff.create,payment_method.create,notification_settings.create)&actor_type=eq.owner`)).length, 0, "생성 시 기본 데이터는 로그 없음");
  const past = new Date(Date.now() - 86_400_000).toISOString();
  await svc("PATCH", `subscriptions?business_id=eq.${bizA}`, { trial_started_at: new Date(Date.now() - 91 * 86_400_000).toISOString(), trial_ends_at: past });
  assert.ok((await rpc(OA, "sync_my_subscription")).ok);
  assert.equal((await logs(`action=eq.trial.end&business_id=eq.${bizA}`)).length, 1);
  assert.equal((await logs(`action=eq.trial.end&business_id=eq.${bizA}`))[0].actor_type, "system");
  await svc("PATCH", `subscriptions?business_id=eq.${bizA}`, { status: "active", current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  assert.deepEqual((await logs(`action=eq.subscription.status_change&business_id=eq.${bizA}`))[0].metadata, { status_from: "expired", status_to: "active" });
});

test("서버 전용 기록: 로그인 실패/성공, 내보내기, 가져오기 (개인정보 없이) — 허용되지 않은 action/개인정보 metadata 는 거부", async () => {
  const ok = await serverLog({ p_business: bizA, p_actor_user: OA.id, p_actor_type: "owner", p_action: "customer.export", p_resource_type: "customer", p_result: "success", p_metadata: { format: "csv", row_count: 120 }, p_ip: "198.51.100.9", p_ua: "ExportAgent" });
  assert.ok(ok.ok, `${ok.status} ${ok.message}`);
  assert.ok((await serverLog({ p_business: bizA, p_actor_user: OA.id, p_actor_type: "owner", p_action: "customer.import", p_resource_type: "customer", p_result: "success", p_metadata: { format: "xlsx", row_count: 50 } })).ok);
  assert.ok((await serverLog({ p_actor_type: "system", p_action: "auth.login", p_resource_type: "auth", p_result: "failure", p_metadata: { reason: "invalid_credentials" } })).ok);
  const ex = (await logs(`action=eq.customer.export&business_id=eq.${bizA}`))[0];
  assert.deepEqual(ex.metadata, { format: "csv", row_count: 120 });
  assert.equal(ex.ip_address, null, "IP 는 기본적으로 저장하지 않는다");
  assert.equal(ex.user_agent, null, "User-Agent 는 기본적으로 저장하지 않는다");
  assert.equal(ex.retain_until, null, "보관기간은 미확정(임의 값 없음)");
  const badAction = await serverLog({ p_actor_type: "system", p_action: "customer.delete", p_resource_type: "customer", p_result: "success" });
  assert.ok(!badAction.ok && badAction.code === "22023" && /audit_action_not_allowed/.test(badAction.message), `허용되지 않은 action: ${badAction.status} ${badAction.message}`);
  const badMeta = await serverLog({ p_actor_type: "system", p_action: "customer.export", p_resource_type: "customer", p_result: "success", p_metadata: { name: PII.custName } });
  assert.ok(!badMeta.ok && /audit_metadata_rejected/.test(badMeta.message), `개인정보 metadata: ${badMeta.status} ${badMeta.message}`);
  const badEmail = await serverLog({ p_actor_type: "system", p_action: "auth.login", p_resource_type: "auth", p_result: "failure", p_metadata: { reason: PII.email } });
  assert.ok(!badEmail.ok && /audit_metadata_rejected/.test(badEmail.message), `이메일 값: ${badEmail.status} ${badEmail.message}`);
});

test("개인정보 검사: 이 테스트가 넣은 이름/전화번호/메모/이메일/메시지가 로그 어디에도 없고, metadata 키는 허용 목록뿐", async () => {
  const all = await logs(`business_id=eq.${bizA}`);
  assert.ok(all.length > 25, `로그가 충분히 쌓였는지: ${all.length}`);
  const dump = JSON.stringify(all);
  for (const [k, v] of Object.entries(PII)) assert.ok(!dump.includes(v), `로그에 ${k} 원문이 있음`);
  assert.ok(!dump.includes("010-"), "전화번호 형태가 로그에 있음");
  assert.ok(!/@/.test(JSON.stringify(all.map((l) => l.metadata))), "이메일 형태가 metadata 에 있음");
  const allowed = new Set(["reason", "changed_fields", "count", "row_count", "format", "source", "channel", "status_from", "status_to", "role_from", "role_to", "invited_role", "error_code", "plan", "trial_source", "denied_reason", "method"]);
  for (const l of all) for (const k of Object.keys(l.metadata)) assert.ok(allowed.has(k), `허용되지 않은 metadata 키: ${k}`);
});

test("조회만 하는 요청은 로그를 남기지 않는다 (로그 폭증 방지)", async () => {
  const n0 = (await svc("GET", "audit_logs?select=seq&limit=1&order=seq.desc"))[0].seq;
  for (let i = 0; i < 5; i++) {
    assert.ok((await call(OA, "GET", `customers?business_id=eq.${bizA}`)).ok);
    assert.ok((await call(SA, "GET", `reservations?business_id=eq.${bizA}`)).ok);
  }
  assert.equal((await svc("GET", "audit_logs?select=seq&limit=1&order=seq.desc"))[0].seq, n0);
});

// ══ 위변조 방지 ══════════════════════════════════════════════════════════
test("로그 수정/삭제: 대표·직원·관리자·운영자·service_role 모두 API 로 불가, 데이터 그대로", async () => {
  const snapshot = JSON.stringify(await logs(`business_id=eq.${bizA}`));
  const total = (await svc("GET", "audit_logs?select=seq")).length;
  const asService = { token: t.serviceKey };
  for (const [who, u] of [["대표", OA], ["직원", SA], ["관리자", MA], ["운영자", PA], ["무소속", U], ["service_role", asService]]) {
    const up = await call(u, "PATCH", `audit_logs?business_id=eq.${bizA}`, { result: "failure", action: "customer.read" });
    assert.ok(!up.ok || up.rows === 0, `${who}: 로그 수정 가능`);
    const del = await call(u, "DELETE", `audit_logs?business_id=eq.${bizA}`);
    assert.ok(!del.ok || del.rows === 0, `${who}: 로그 삭제 가능`);
    const wipe = await call(u, "DELETE", "audit_logs?seq=gt.0");
    assert.ok(!wipe.ok || wipe.rows === 0, `${who}: 전체 삭제 가능`);
  }
  assert.equal(JSON.stringify(await logs(`business_id=eq.${bizA}`)), snapshot, "로그가 바뀜");
  assert.equal((await svc("GET", "audit_logs?select=seq")).length, total, "로그 수가 줄어듦");
});

test("로그 위조: 일반 사용자는 audit_logs 에 직접 쓰거나 기록 함수를 호출할 수 없다", async () => {
  for (const [who, u] of [["대표", OA], ["직원", SA], ["운영자", PA]]) {
    assert.ok(!(await call(u, "POST", "audit_logs", { business_id: bizA, actor_type: "owner", action: "customer.delete", resource_type: "customer", result: "success" })).ok, `${who}: 직접 INSERT`);
    assert.ok(!(await rpc(u, "audit_write", { p_business: bizA, p_actor_user: null, p_actor_type: "owner", p_action: "customer.delete", p_resource_type: "customer", p_resource_id: null, p_result: "success" })).ok, `${who}: audit_write`);
    assert.ok(!(await rpc(u, "audit_log_server", { p_actor_type: "owner", p_action: "customer.export", p_resource_type: "customer", p_result: "success" })).ok, `${who}: audit_log_server`);
  }
});

// ══ 로그 조회 격리 ═══════════════════════════════════════════════════════
const COLS = "select=seq,id,business_id,actor_type,action,resource_type,resource_id,result,metadata,created_at";
test("로그 조회: 대표는 자기 사업장 로그만, B 는 A 의 로그를 볼 수 없다 (필터로 지정해도 빈 결과)", async () => {
  const a = await call(OA, "GET", `audit_logs?${COLS}&limit=1000`);
  assert.ok(a.ok && a.rows > 25 && a.json.every((l) => l.business_id === bizA), "A 대표는 A 로그만");
  const b = await call(OB, "GET", `audit_logs?${COLS}&limit=1000`);
  assert.ok(b.ok && b.rows >= 2 && b.json.every((l) => l.business_id === bizB), "B 대표는 B 로그만");
  assert.deepEqual((await call(OB, "GET", `audit_logs?${COLS}&business_id=eq.${bizA}`)).json, [], "B 가 A 로그를 필터로 조회");
  assert.deepEqual((await call(OB, "GET", `audit_logs?${COLS}&resource_id=eq.${ids.cust}`)).json, [], "B 가 A 의 고객 로그를 resource_id 로 조회");
  assert.deepEqual((await call(OB, "GET", `audit_logs?${COLS}&actor_user_id=eq.${OA.id}`)).json, [], "B 가 A 대표의 로그를 actor 로 조회");
});
test("로그 조회: 직원·관리자·운영자·무소속은 직접 조회 불가(빈 결과), IP/User-Agent 컬럼은 대표도 조회 불가", async () => {
  for (const [who, u] of [["직원", SA], ["관리자", MA], ["운영자", PA], ["무소속", U]]) {
    const r = await call(u, "GET", `audit_logs?${COLS}`);
    assert.ok(!r.ok || r.rows === 0, `${who}: 직접 조회됨`);
  }
  assert.ok(!(await call(OA, "GET", "audit_logs?select=ip_address")).ok, "대표가 ip_address 조회");
  assert.ok(!(await call(OA, "GET", "audit_logs?select=user_agent")).ok, "대표가 user_agent 조회");
  assert.ok(!(await call(OA, "GET", "audit_logs?select=*")).ok, "select=* 로 ip/ua 가 딸려 나옴");
  const anon = await call(null, "GET", `audit_logs?${COLS}`);
  assert.ok(!anon.ok || anon.rows === 0, "로그인 없이 조회");
});

// ══ 플랫폼 관리자 ═══════════════════════════════════════════════════════
test("일반 사용자(대표/관리자/직원/무소속/타 사업장)는 운영자 API 를 호출할 수 없다 (403)", async () => {
  for (const [who, u] of [["대표", OA], ["관리자", MA], ["직원", SA], ["무소속", U], ["B 대표", OB]]) {
    for (const [fn, args] of [["admin_dashboard", {}], ["admin_list_businesses", {}], ["admin_business_detail", { p_business: bizA }], ["admin_recent_audit_logs", {}]]) {
      const r = await rpc(u, fn, args);
      assert.ok(!r.ok && (r.status === 403 || r.status === 401), `${who}: ${fn} → ${r.status}`);
      assert.equal(r.code, "42501");
    }
    assert.equal((await rpc(u, "is_platform_admin")).json, false, `${who}: is_platform_admin`);
  }
  const anon = await rpc(null, "admin_dashboard");
  assert.ok(!anon.ok, "로그인 없이 호출");
});

test("일반 사용자는 스스로 운영자가 될 수 없다 (platform_admins 접근·profiles 권한 조작 모두 차단)", async () => {
  for (const [who, u] of [["대표", OA], ["관리자", MA], ["직원", SA], ["무소속", U]]) {
    assert.ok(!(await call(u, "POST", "platform_admins", { user_id: u.id })).ok, `${who}: 등록`);
    assert.ok(blocked(await call(u, "PATCH", "platform_admins?active=eq.false", { active: true })), `${who}: 수정`);
    const sel = await call(u, "GET", "platform_admins?select=user_id");
    assert.ok(!sel.ok || sel.rows === 0, `${who}: 조회`);
    assert.ok(blocked(await call(u, "PATCH", `profiles?id=eq.${u.id}`, { role: "owner", business_id: null })), `${who}: profiles 조작`);
  }
  const list = await svc("GET", "platform_admins?select=user_id");
  assert.deepEqual(list.map((r) => r.user_id), [PA.id], "운영자는 service 로 등록된 1명뿐");
  assert.equal((await rpc(PA, "is_platform_admin")).json, true);
});

test("운영자: 대시보드/검색/상세/로그 조회 가능 — 집계와 사업장 정보만, 고객 개인정보 없음", async () => {
  const d = await rpc(PA, "admin_dashboard");
  assert.ok(d.ok, `${d.status} ${d.message}`);
  const dash = d.json;
  const totalBiz = (await svc("GET", "businesses?select=id")).length;
  assert.equal(dash.total, totalBiz);
  for (const k of ["trial", "expired", "expired_denied", "active", "canceled", "suspended"]) assert.equal(typeof dash[k], "number", k);
  assert.ok(Array.isArray(dash.recent_signups) && Array.isArray(dash.recent_trial_starts) && Array.isArray(dash.recent_trial_ends) && Array.isArray(dash.recent_inquiries));
  assert.ok(dash.recent_signups.some((b) => b.id === bizA));

  const byName = await rpc(PA, "admin_list_businesses", { p_query: `감사시험A-${run}` });
  assert.equal(byName.json.filter((r) => r.id === bizA).length, 1);
  const byRep = await rpc(PA, "admin_list_businesses", { p_query: `대표-감사시험B-${run}` });
  assert.equal(byRep.json.filter((r) => r.id === bizB).length, 1, "대표자명 검색");
  assert.equal((await rpc(PA, "admin_list_businesses", { p_query: "111-**-***11" })).json.length, 0, "마스킹 사업자번호로는 검색 불가");
  assert.equal((await rpc(PA, "admin_list_businesses", { p_query: "%" })).json.length, 0, "% 는 문자 그대로");
  assert.ok((await rpc(PA, "admin_list_businesses", { p_status: "active" })).json.some((r) => r.id === bizA), "상태 필터(active)");
  assert.ok((await rpc(PA, "admin_list_businesses", { p_limit: 100000 })).json.length <= 100, "조회 개수 상한");

  const det = await rpc(PA, "admin_business_detail", { p_business: bizA });
  assert.ok(det.ok);
  assert.equal(det.json.name, `감사시험A-${run}(수정)`);
  assert.equal(det.json.representative_name, `대표-감사시험A-${run}`);
  assert.equal(det.json.customer_count, (await svc("GET", `customers?business_id=eq.${bizA}&select=id`)).length);
  assert.equal(det.json.payment_count, (await svc("GET", `payments?business_id=eq.${bizA}&select=id`)).length);
  assert.equal(det.json.staff_count, (await svc("GET", `staff?business_id=eq.${bizA}&select=id`)).length);
  assert.ok(det.json.last_activity_at && det.json.trial_started_at && det.json.trial_ends_at);
  const all = JSON.stringify([dash, byName.json, det.json]);
  for (const v of [PII.custName, PII.custPhone, PII.memo, "직원수정", "010-"]) assert.ok(!all.includes(v), `운영자 응답에 개인정보(${v})가 있음`);
  assert.equal(await has("platform.business_view", bizA, "platform_admin", bizA, PA.id), 1, "상세 열람이 로그로 남음");
  assert.ok(!(await rpc(PA, "admin_business_detail", { p_business: crypto.randomUUID() })).ok);

  const lg = await rpc(PA, "admin_recent_audit_logs", { p_business: bizA, p_action: "customer.create" });
  assert.ok(lg.ok && lg.json.length >= 1 && !("ip_address" in lg.json[0]) && !("user_agent" in lg.json[0]));
});

test("운영자는 사업장 권한으로 데이터를 우회해 볼/쓸 수 없다 (일반 테이블 0행, 쓰기 차단, 직급 함수 차단)", async () => {
  for (const tbl of ["customers", "reservations", "consultations", "payments", "staff", "businesses", "subscriptions", "audit_logs", "inquiries", "staff_invitations"]) {
    const r = await call(PA, "GET", `${tbl}?select=id&limit=5`);
    assert.ok(!r.ok || r.rows === 0, `운영자가 ${tbl} 를 직접 조회함`);
  }
  assert.ok(blocked(await call(PA, "POST", "customers", { business_id: bizA, name: "운영자침입" })));
  assert.ok(blocked(await call(PA, "PATCH", `customers?id=eq.${ids.cust}`, { name: "해킹" })));
  assert.ok(blocked(await call(PA, "DELETE", `customers?id=eq.${ids.cust}`)));
  assert.ok(blocked(await call(PA, "PATCH", `businesses?id=eq.${bizA}`, { name: "해킹" })));
  assert.ok(blocked(await call(PA, "PATCH", `subscriptions?business_id=eq.${bizA}`, { status: "suspended" })));
  assert.ok(!(await rpc(PA, "set_member_role", { p_staff_id: ids.stLabel, p_role: "manager" })).ok, "직급 변경");
  assert.ok(!(await rpc(PA, "create_staff_invitation", { p_staff_id: ids.stLabel, p_email: "x@gmail.com", p_token_hash: hash() })).ok, "직원 초대");
  assert.ok(!(await rpc(PA, "unlink_staff_account", { p_staff_id: ids.stS })).ok, "연결 해제");
  assert.ok(blocked(await call(PA, "PATCH", `profiles?id=eq.${PA.id}`, { business_id: bizA, role: "owner" })), "운영자가 자기 프로필에 사업장/직급을 붙이려는 시도");
  assert.equal((await svc("GET", `customers?id=eq.${ids.cust}&select=name`))[0].name, PII.custName);
  assert.equal((await svc("GET", `profiles?id=eq.${PA.id}&select=business_id`))[0].business_id, null);
});

test("운영자 비활성화 즉시 반영, 운영자 등록/해제는 로그로 남는다", async () => {
  await svc("PATCH", `platform_admins?user_id=eq.${PA.id}`, { active: false });
  const off = await rpc(PA, "admin_dashboard");
  assert.ok(!off.ok && off.code === "42501", "비활성 운영자가 호출됨");
  assert.equal((await rpc(PA, "is_platform_admin")).json, false);
  await svc("PATCH", `platform_admins?user_id=eq.${PA.id}`, { active: true });
  assert.ok((await rpc(PA, "admin_dashboard")).ok);
  const g = await logs(`action=in.(platform_admin.grant,platform_admin.revoke)&resource_id=eq.${PA.id}`);
  assert.deepEqual(g.map((l) => l.action), ["platform_admin.grant", "platform_admin.revoke", "platform_admin.grant"]);
  assert.ok(g.every((l) => l.actor_type === "system" && l.business_id === null));
});

test("탈퇴: 사업장 삭제 시 business.delete 1건만 남고 로그는 유지된다 (연쇄 삭제 노이즈 없음)", async () => {
  const tmp = await mkUser("tmp");
  const biz = (await rpc(tmp, "create_my_business", { p_name: `탈퇴시험-${run}`, p_business_number_hash: hash(), p_business_number_masked: "***" })).json;
  await svc("POST", "customers", { business_id: biz, name: "탈퇴고객1" });
  await svc("POST", "customers", { business_id: biz, name: "탈퇴고객2" });
  const before_ = (await logs(`business_id=eq.${biz}`)).length;
  assert.ok((await admin("DELETE", `/${tmp.id}`)).ok);
  const after_ = await logs(`business_id=eq.${biz}`);
  assert.equal(after_.filter((l) => l.action === "business.delete").length, 1);
  assert.equal(after_.filter((l) => l.action.endsWith(".delete") && l.action !== "business.delete").length, 0, "연쇄 삭제된 행이 개별 로그로 남음");
  assert.ok(after_.length > before_ && after_.some((l) => l.action === "business.create"), "탈퇴 후에도 이전 로그 유지");
  assert.equal((await svc("GET", `businesses?id=eq.${biz}&select=id`)).length, 0);
});

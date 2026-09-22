// 직원 계정 초대/연결/해제(008) 통합 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 실제 Auth JWT 로 PostgREST/RPC 를 직접 호출하고, 수락 단계는 서버가 하는 일(service_role: 계정 생성 + finalize)을 그대로 재현한다.
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
  return { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : {} };
};
async function mkUser(label) {
  const email = `inv-${run}-${label}@gmail.com`;
  const r = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: `T-${label}` } });
  assert.ok(r.ok, `create ${label}: ${r.status}`);
  created.push(r.json.id);
  // 로그인 요청 한도(429)를 피하려고 테스트 프로젝트 서명 키로 토큰을 발급한다. 로그인 자체가 필요한 검사는 실제 로그인을 쓴다.
  const token = (await mintUserToken(t, { id: r.json.id, email })) ?? (await (await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) })).json()).access_token;
  return { id: r.json.id, email, token };
}
const call = async (u, method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { apikey: t.anonKey, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: r.status, ok: r.ok, json, code: json?.code, message: json?.message ?? "" };
};
const svcRpc = async (fn, args) => {
  const r = await fetch(`${t.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: SH, body: JSON.stringify(args) });
  const text = await r.text();
  return { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : null };
};
const svc = async (method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { ...SH, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  assert.ok(r.ok, `svc ${method} ${pq}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
};
const newToken = () => { const token = crypto.randomBytes(32).toString("base64url"); return { token, hash: crypto.createHash("sha256").update(token).digest("hex") }; };
const invite = (u, staffId, email, hash) => call(u, "POST", "rpc/create_staff_invitation", { p_staff_id: staffId, p_email: email, p_token_hash: hash });

let O, M, S, Y, bizA, bizB, ids = {};

before(async () => {
  [O, M, S, Y] = await Promise.all([mkUser("owner"), mkUser("manager"), mkUser("staff"), mkUser("yowner")]);
  const create = async (u, name) => (await (await fetch(`${t.url}/rest/v1/rpc/create_my_business`, { method: "POST", headers: { apikey: t.anonKey, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_name: name, p_business_number_hash: crypto.randomBytes(32).toString("hex") }) })).json());
  bizA = await create(O, `INV-A-${run}`);
  bizB = await create(Y, `INV-B-${run}`);
  await svc("PATCH", `profiles?id=eq.${M.id}`, { business_id: bizA, role: "manager" });
  await svc("PATCH", `profiles?id=eq.${S.id}`, { business_id: bizA, role: "staff" });
  await svc("POST", "staff", { business_id: bizA, profile_id: M.id, name: "관리자", role: "manager" });
  await svc("POST", "staff", { business_id: bizA, profile_id: S.id, name: "기존직원", role: "staff" });
  const mk = async (b, name, role) => (await svc("POST", "staff", { business_id: b, name, role }))[0].id;
  ids.label = await mk(bizA, "라벨직원", "staff");
  ids.labelMgr = await mk(bizA, "라벨관리자", "manager");
  ids.labelB = await mk(bizB, "B라벨", "staff");
  ids.custA = (await svc("POST", "customers", { business_id: bizA, name: "A고객" }))[0].id;
  ids.custB = (await svc("POST", "customers", { business_id: bizB, name: "B고객" }))[0].id;
});

after(async () => {
  for (const id of created) await admin("DELETE", `/${id}`);
});

const newInvitee = { email: `inv-${run}-new@gmail.com` };
let inviteToken;

test("직원(staff)은 초대를 만들 수 없다", async () => {
  const { hash } = newToken();
  const r = await invite(S, ids.label, newInvitee.email, hash);
  assert.ok(!r.ok); assert.equal(r.code, "42501");
});
test("다른 사업장 대표는 이 사업장 담당자를 초대할 수 없다", async () => {
  const r = await invite(Y, ids.label, newInvitee.email, newToken().hash);
  assert.ok(!r.ok); assert.equal(r.code, "P0002");
});
test("관리자는 관리자급 담당자를 초대할 수 없다 (대표 전용)", async () => {
  const r = await invite(M, ids.labelMgr, newInvitee.email, newToken().hash);
  assert.ok(!r.ok); assert.equal(r.code, "42501");
});
test("이미 가입된 이메일로는 초대할 수 없다", async () => {
  const r = await invite(O, ids.label, S.email, newToken().hash);
  assert.ok(!r.ok); assert.match(r.message, /email_taken/);
});
test("이메일 형식 오류는 거부된다", async () => {
  const r = await invite(O, ids.label, "not-an-email", newToken().hash);
  assert.ok(!r.ok); assert.equal(r.code, "22023");
});

test("관리자는 직원급 담당자를 초대할 수 있다 (초대 생성)", async () => {
  const { token, hash } = newToken();
  const r = await invite(M, ids.label, newInvitee.email, hash);
  assert.ok(r.ok, `${r.status} ${JSON.stringify(r.json)}`);
  inviteToken = { token, hash };
});

test("초대 목록은 대표/관리자만 보고, token_hash 는 아무도 조회할 수 없다", async () => {
  const rows = await call(O, "GET", `staff_invitations?business_id=eq.${bizA}&select=id,email,staff_id`);
  assert.ok(rows.ok && rows.json.length === 1 && rows.json[0].email === newInvitee.email);
  assert.deepEqual((await call(S, "GET", `staff_invitations?business_id=eq.${bizA}&select=id,email`)).json, [], "직원이 초대 목록을 봄");
  assert.deepEqual((await call(Y, "GET", `staff_invitations?business_id=eq.${bizA}&select=id,email`)).json, [], "다른 사업장이 초대 목록을 봄");
  const leak = await call(O, "GET", `staff_invitations?select=token_hash`);
  assert.ok(!leak.ok, "대표가 token_hash 를 조회함");
  const star = await call(O, "GET", "staff_invitations?select=*");
  assert.ok(!star.ok, "select=* 로 token_hash 가 딸려 나옴");
});

test("초대 테이블 직접 쓰기(만료 연장·생성)는 불가", async () => {
  assert.ok(!(await call(O, "PATCH", `staff_invitations?business_id=eq.${bizA}`, { expires_at: "2099-01-01T00:00:00Z" })).ok);
  assert.ok(!(await call(O, "POST", "staff_invitations", { business_id: bizA, staff_id: ids.label, email: "x@gmail.com", role: "staff", token_hash: "0".repeat(64), expires_at: "2099-01-01T00:00:00Z" })).ok);
});

test("수락 함수(lookup/finalize)는 브라우저 권한으로 호출 불가, 서버(service_role)만 가능", async () => {
  const asUser = (u, fn, args) => call(u, "POST", `rpc/${fn}`, args);
  for (const u of [O, S]) {
    assert.ok(!(await asUser(u, "lookup_staff_invitation", { p_token_hash: inviteToken.hash })).ok, "authenticated 가 lookup 호출");
    assert.ok(!(await asUser(u, "finalize_staff_invitation", { p_token_hash: inviteToken.hash, p_user_id: u.id })).ok, "authenticated 가 finalize 호출");
  }
  const anon = await fetch(`${t.url}/rest/v1/rpc/lookup_staff_invitation`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ p_token_hash: inviteToken.hash }) });
  assert.ok(!anon.ok, "anon 이 lookup 호출");
  const ok = await svcRpc("lookup_staff_invitation", { p_token_hash: inviteToken.hash });
  assert.ok(ok.ok && ok.json.length === 1 && ok.json[0].email === newInvitee.email && ok.json[0].role === "staff");
});

test("잘못된/없는 토큰은 조회되지 않는다", async () => {
  assert.deepEqual((await svcRpc("lookup_staff_invitation", { p_token_hash: newToken().hash })).json, []);
});

test("수락: 이메일이 다른 계정으로는 연결 불가 → 초대는 그대로 유효", async () => {
  const other = await mkUser("attacker");
  const r = await svcRpc("finalize_staff_invitation", { p_token_hash: inviteToken.hash, p_user_id: other.id });
  assert.ok(!r.ok);
  assert.equal((await svc("GET", `profiles?id=eq.${other.id}&select=business_id`))[0].business_id, null);
  assert.equal((await svcRpc("lookup_staff_invitation", { p_token_hash: inviteToken.hash })).json.length, 1);
});

let invitee;
test("수락: 서버가 계정을 만들고 초대된 사업장·직급에 연결한다 (1회용)", async () => {
  const c = await admin("POST", "", { email: newInvitee.email, password: PW, email_confirm: true, user_metadata: { full_name: "초대직원" } });
  assert.ok(c.ok, `create ${c.status}`);
  created.push(c.json.id);
  const f = await svcRpc("finalize_staff_invitation", { p_token_hash: inviteToken.hash, p_user_id: c.json.id });
  assert.ok(f.ok, `finalize ${f.status} ${JSON.stringify(f.json)}`);
  assert.equal(f.json, ids.label);
  const [p] = await svc("GET", `profiles?id=eq.${c.json.id}&select=business_id,role`);
  assert.equal(p.business_id, bizA); assert.equal(p.role, "staff");
  assert.equal((await svc("GET", `staff?id=eq.${ids.label}&select=profile_id`))[0].profile_id, c.json.id);
  // 같은 링크 재사용 불가
  const again = await svcRpc("finalize_staff_invitation", { p_token_hash: inviteToken.hash, p_user_id: c.json.id });
  assert.ok(!again.ok, "1회용 초대가 재사용됨");
  assert.deepEqual((await svcRpc("lookup_staff_invitation", { p_token_hash: inviteToken.hash })).json, []);
  const l = await (await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: newInvitee.email, password: PW }) })).json();
  invitee = { id: c.json.id, email: newInvitee.email, token: l.access_token };
  assert.ok(invitee.token, "초대받은 직원이 설정한 비밀번호로 로그인되지 않음");
});

test("초대받은 직원: 초대된 사업장만 접근, 다른 사업장/직급 상승/매출은 차단", async () => {
  assert.equal((await call(invitee, "GET", `customers?business_id=eq.${bizA}`)).json.length, 1);
  assert.deepEqual((await call(invitee, "GET", `customers?business_id=eq.${bizB}`)).json, []);
  assert.deepEqual((await call(invitee, "GET", `staff?business_id=eq.${bizB}`)).json, []);
  assert.ok(!(await call(invitee, "PATCH", `profiles?id=eq.${invitee.id}`, { role: "owner" })).ok);
  assert.ok(!(await call(invitee, "PATCH", `profiles?id=eq.${invitee.id}`, { business_id: bizB })).ok);
  assert.ok(!(await call(invitee, "DELETE", `customers?id=eq.${ids.custA}`)).ok || (await svc("GET", `customers?id=eq.${ids.custA}&select=id`)).length === 1, "초대 직원이 고객 삭제");
  assert.equal((await svc("GET", `customers?id=eq.${ids.custA}&select=id`)).length, 1);
  assert.deepEqual((await call(invitee, "GET", `payments?business_id=eq.${bizA}`)).json, []);
  assert.ok(!(await invite(invitee, ids.labelMgr, "z@gmail.com", newToken().hash)).ok, "초대 직원이 다른 직원을 초대함");
});

test("연결된 담당자 행은 삭제할 수 없다 (먼저 해제해야 함)", async () => {
  const r = await call(O, "DELETE", `staff?id=eq.${ids.label}`);
  assert.ok(!r.ok || r.json.length === 0);
  assert.equal((await svc("GET", `staff?id=eq.${ids.label}&select=id`)).length, 1);
});

test("해제 권한: 직원 불가, 다른 사업장 대표 불가, 관리자는 직원급만", async () => {
  assert.equal((await call(S, "POST", "rpc/unlink_staff_account", { p_staff_id: ids.label })).code, "42501");
  assert.equal((await call(Y, "POST", "rpc/unlink_staff_account", { p_staff_id: ids.label })).code, "P0002");
  const ownerRow = (await svc("GET", `staff?business_id=eq.${bizA}&role=eq.owner&select=id`))[0].id;
  assert.equal((await call(M, "POST", "rpc/unlink_staff_account", { p_staff_id: ownerRow })).code, "42501");
});

test("해제: 사업장 접근이 즉시 사라지고, 서버가 계정을 삭제하면 로그인 불가", async () => {
  const r = await call(M, "POST", "rpc/unlink_staff_account", { p_staff_id: ids.label });
  assert.ok(r.ok, `${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(r.json, invitee.id);
  assert.equal((await svc("GET", `staff?id=eq.${ids.label}&select=profile_id`))[0].profile_id, null);
  assert.equal((await svc("GET", `profiles?id=eq.${invitee.id}&select=business_id`))[0].business_id, null);
  // 아직 계정이 남아 있어도(토큰이 살아 있어도) 데이터는 못 본다
  assert.deepEqual((await call(invitee, "GET", `customers?business_id=eq.${bizA}`)).json, []);
  // 서버 액션이 하는 계정 삭제
  assert.ok((await admin("DELETE", `/${invitee.id}`)).ok);
  const login = await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: invitee.email, password: PW }) });
  assert.ok(!login.ok, "해제된 계정이 로그인됨");
});

test("해제 후 같은 담당자를 다시 초대할 수 있고, 초대 취소하면 링크가 무효", async () => {
  const { hash } = newToken();
  const r = await invite(O, ids.label, newInvitee.email, hash);
  assert.ok(r.ok, `${r.status} ${JSON.stringify(r.json)}`);
  assert.equal((await svcRpc("lookup_staff_invitation", { p_token_hash: hash })).json.length, 1);
  const rv = await call(M, "POST", "rpc/revoke_staff_invitation", { p_staff_id: ids.label });
  assert.ok(rv.ok && rv.json === 1);
  assert.deepEqual((await svcRpc("lookup_staff_invitation", { p_token_hash: hash })).json, []);
});

test("재발급하면 이전 링크는 무효가 된다", async () => {
  const a = newToken(), b = newToken();
  assert.ok((await invite(O, ids.label, newInvitee.email, a.hash)).ok);
  assert.ok((await invite(O, ids.label, newInvitee.email, b.hash)).ok);
  assert.deepEqual((await svcRpc("lookup_staff_invitation", { p_token_hash: a.hash })).json, []);
  assert.equal((await svcRpc("lookup_staff_invitation", { p_token_hash: b.hash })).json.length, 1);
});

// 권한 상승 / 매장 간 격리 통합 테스트 — "테스트 Supabase 프로젝트"에서만 실행된다.
// 실제 Supabase Auth 로 로그인해 얻은 JWT 로 PostgREST 를 직접 호출한다
// (앱 화면을 우회해서 API 를 직접 두드리는 공격자와 같은 경로).
//   npm run test:integration
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTarget } from "../../scripts/lib/env.mjs";

const t = loadTarget("test"); // 운영 DB 를 가리키면 여기서 예외로 중단된다
const run = crypto.randomBytes(4).toString("hex");
const PASSWORD = `Pw-${crypto.randomBytes(9).toString("base64url")}`;

const svcHeaders = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };
const created = [];

async function createUser(label) {
  const email = `itest-${run}-${label}@example.com`;
  const res = await fetch(`${t.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `T-${label}` } }),
  });
  assert.ok(res.ok, `create user ${label}: ${res.status} ${await res.clone().text()}`);
  const user = await res.json();
  created.push(user.id);
  const login = await fetch(`${t.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: t.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.ok(login.ok, `login ${label}: ${login.status}`);
  return { id: user.id, email, token: (await login.json()).access_token };
}

const asUser = (u) => ({ apikey: t.anonKey, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json", Prefer: "return=representation" });
const rest = (u, method, pathQuery, body) =>
  fetch(`${t.url}/rest/v1/${pathQuery}`, { method, headers: asUser(u), body: body ? JSON.stringify(body) : undefined });
const svc = (method, pathQuery, body) =>
  fetch(`${t.url}/rest/v1/${pathQuery}`, { method, headers: { ...svcHeaders, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
const rpc = (u, fn, args) => rest(u, "POST", `rpc/${fn}`, args);
const denied = (res) => !res.ok; // 4xx (403 42501 등)

let A, B, S, bizA, bizB, staffS;

before(async () => {
  [A, B, S] = await Promise.all([createUser("a"), createUser("b"), createUser("s")]);
  bizA = await (await rpc(A, "create_my_business", { p_name: `A-${run}`, p_business_number_hash: crypto.randomBytes(32).toString("hex") })).json();
  bizB = await (await rpc(B, "create_my_business", { p_name: `B-${run}`, p_business_number_hash: crypto.randomBytes(32).toString("hex") })).json();
  assert.match(String(bizA), /^[0-9a-f-]{36}$/);
  assert.match(String(bizB), /^[0-9a-f-]{36}$/);

  // S 를 A 사업장의 직원 계정으로 연결 (초대 기능 전이므로 service_role 로 셋업)
  await svc("PATCH", `profiles?id=eq.${S.id}`, { business_id: bizA, role: "staff" });
  const st = await (await svc("POST", "staff", { business_id: bizA, profile_id: S.id, name: "S직원", role: "staff" })).json();
  staffS = st[0].id;

  // B 사업장에 고객 1명 (A 가 볼 수 없어야 함)
  await svc("POST", "customers", { business_id: bizB, name: `B고객-${run}`, phone: "01000000000" });
});

after(async () => {
  for (const id of created) await fetch(`${t.url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: svcHeaders });
});

const profileOf = async (id) => (await (await svc("GET", `profiles?id=eq.${id}&select=role,business_id`)).json())[0];

test("직원이 API 로 자기 role 을 owner 로 변경 → 거부되고 값이 그대로", async () => {
  const res = await rest(S, "PATCH", `profiles?id=eq.${S.id}`, { role: "owner" });
  assert.ok(denied(res), `status ${res.status}`);
  assert.equal((await profileOf(S.id)).role, "staff");
});

test("직원이 API 로 business_id 를 다른 매장(B)으로 변경 → 거부", async () => {
  const res = await rest(S, "PATCH", `profiles?id=eq.${S.id}`, { business_id: bizB });
  assert.ok(denied(res), `status ${res.status}`);
  assert.equal((await profileOf(S.id)).business_id, bizA);
});

test("대표(A)가 자기 business_id 를 B 로 바꿔 B 를 탈취 → 거부", async () => {
  const res = await rest(A, "PATCH", `profiles?id=eq.${A.id}`, { business_id: bizB, role: "owner" });
  assert.ok(denied(res), `status ${res.status}`);
  assert.equal((await profileOf(A.id)).business_id, bizA);
});

test("본인 이름/전화번호 수정은 허용", async () => {
  const res = await rest(S, "PATCH", `profiles?id=eq.${S.id}`, { full_name: "새이름", phone: "010-1234-5678" });
  assert.ok(res.ok, `status ${res.status}`);
});

test("businesses 를 API 로 직접 생성 → 거부", async () => {
  const res = await rest(A, "POST", "businesses", { owner_id: A.id, name: "몰래 만든 매장" });
  assert.ok(denied(res), `status ${res.status}`);
});

test("이미 매장이 있는 계정의 create_my_business 재호출 → 거부(23505)", async () => {
  const res = await rpc(A, "create_my_business", { p_name: "두번째" });
  assert.ok(denied(res));
  assert.equal((await res.json()).code, "23505");
});

test("직원은 set_member_role 호출 불가(42501)", async () => {
  const res = await rpc(S, "set_member_role", { p_staff_id: staffS, p_role: "manager" });
  assert.ok(denied(res));
  assert.equal((await res.json()).code, "42501");
});

test("대표는 owner 등급을 부여할 수 없다", async () => {
  const res = await rpc(A, "set_member_role", { p_staff_id: staffS, p_role: "owner" });
  assert.ok(denied(res));
  assert.equal((await profileOf(S.id)).role, "staff");
});

test("다른 사업장(B) 대표는 A 의 직원 등급을 바꿀 수 없다(not_found)", async () => {
  const res = await rpc(B, "set_member_role", { p_staff_id: staffS, p_role: "manager" });
  assert.ok(denied(res));
  assert.equal((await profileOf(S.id)).role, "staff");
});

test("대표(A)는 자기 직원 등급 변경 가능하고 profiles 에도 반영", async () => {
  const res = await rpc(A, "set_member_role", { p_staff_id: staffS, p_role: "manager" });
  assert.ok(res.ok, `status ${res.status}`);
  assert.equal((await profileOf(S.id)).role, "manager");
});

test("A 는 B 의 고객/매장 정보를 조회할 수 없다 (빈 결과)", async () => {
  const customers = await (await rest(A, "GET", `customers?business_id=eq.${bizB}`)).json();
  assert.deepEqual(customers, []);
  const biz = await (await rest(A, "GET", `businesses?id=eq.${bizB}`)).json();
  assert.deepEqual(biz, []);
});

test("A 는 B 사업장 소속으로 고객을 만들 수 없다", async () => {
  const res = await rest(A, "POST", "customers", { business_id: bizB, name: "침입" });
  assert.ok(denied(res), `status ${res.status}`);
});

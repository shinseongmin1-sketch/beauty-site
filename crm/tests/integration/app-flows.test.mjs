// 앱이 실제로 쓰는 DB 호출 흐름 회귀 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 서버 액션이 하는 호출(온보딩 → 담당자 추가/수정/삭제 → 매장 설정 수정 → 고객/예약/매출 CRUD)을
// 실제 로그인 JWT 로 그대로 재현한다.
// 005 만 적용된 상태(잠금 전)와 006 까지 적용된 상태(잠금 후) 양쪽에서 모두 통과해야 한다.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTarget } from "../../scripts/lib/env.mjs";

const t = loadTarget("test");
const run = crypto.randomBytes(4).toString("hex");
const PASSWORD = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const svcHeaders = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };

let user, biz, ownerStaffId, extraStaffId, customerId, serviceId, reservationId;

const H = () => ({ apikey: t.anonKey, Authorization: `Bearer ${user.token}`, "Content-Type": "application/json", Prefer: "return=representation" });
const rest = (method, pq, body) => fetch(`${t.url}/rest/v1/${pq}`, { method, headers: H(), body: body ? JSON.stringify(body) : undefined });
const ok = async (res, what) => {
  const text = await res.text();
  assert.ok(res.ok, `${what}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

before(async () => {
  const email = `flow-${run}@example.com`;
  const cu = await fetch(`${t.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "흐름테스트" } }),
  });
  assert.ok(cu.ok, `create user ${cu.status}`);
  const id = (await cu.json()).id;
  const login = await fetch(`${t.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: t.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  user = { id, token: (await login.json()).access_token };
});

after(async () => {
  if (user) await fetch(`${t.url}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: svcHeaders });
});

test("가입 직후 프로필이 트리거로 자동 생성되고 매장은 아직 없다", async () => {
  const rows = await ok(await rest("GET", `profiles?id=eq.${user.id}&select=business_id,role,full_name`), "profile");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].business_id, null);
  assert.equal(rows[0].full_name, "흐름테스트");
});

test("온보딩: create_my_business 로 매장/대표 직원/기본 데이터가 한 번에 만들어진다", async () => {
  // 최종 상태(009 이후)는 사업자번호 해시가 필수이고, 005 상태에서는 그 인자가 없다. 두 서명 모두에서 온보딩 호출이 동작해야 한다.
  const legacyArgs = { p_name: `흐름매장-${run}`, p_phone: "02-1234-5678", p_address: "서울" };
  let res = await rest("POST", "rpc/create_my_business", { ...legacyArgs, p_representative_name: "대표", p_business_number_hash: crypto.randomBytes(32).toString("hex"), p_business_number_masked: "***" });
  if (!res.ok && res.status === 404) res = await rest("POST", "rpc/create_my_business", legacyArgs);
  biz = await ok(res, "rpc");
  assert.match(String(biz), /^[0-9a-f-]{36}$/);

  const [p] = await ok(await rest("GET", `profiles?id=eq.${user.id}&select=business_id,role`), "profile");
  assert.equal(p.business_id, biz);
  assert.equal(p.role, "owner");

  const staff = await ok(await rest("GET", `staff?business_id=eq.${biz}&select=id,role,profile_id`), "staff");
  assert.equal(staff.length, 1);
  assert.equal(staff[0].role, "owner");
  assert.equal(staff[0].profile_id, user.id);
  ownerStaffId = staff[0].id;

  assert.equal((await ok(await rest("GET", `payment_methods?business_id=eq.${biz}`), "pm")).length, 3);
  assert.equal((await ok(await rest("GET", `notification_settings?business_id=eq.${biz}`), "ns")).length, 1);
});

test("담당자 추가/수정/등급 변경/삭제 (staff/actions.ts 와 같은 호출)", async () => {
  const [row] = await ok(await rest("POST", "staff", { business_id: biz, name: "디자이너", phone: null, title: "실장", role: "manager", color: "#123456" }), "addStaff");
  extraStaffId = row.id;

  const upd = await ok(await rest("PATCH", `staff?id=eq.${extraStaffId}&business_id=eq.${biz}&select=role`, { name: "디자이너2", phone: "010", title: "팀장", color: "#654321" }), "updateStaff");
  assert.equal(upd.length, 1);

  await ok(await rest("POST", "rpc/set_member_role", { p_staff_id: extraStaffId, p_role: "staff" }), "set_member_role");
  const [after] = await ok(await rest("GET", `staff?id=eq.${extraStaffId}&select=role`), "read");
  assert.equal(after.role, "staff");

  await ok(await rest("PATCH", `staff?id=eq.${extraStaffId}&business_id=eq.${biz}`, { active: false }), "toggleStaffActive");

  // deleteStaff: 대표 행은 neq.owner 필터로 삭제 대상에서 제외된다
  const delOwner = await ok(await rest("DELETE", `staff?id=eq.${ownerStaffId}&business_id=eq.${biz}&role=neq.owner`), "delete owner row");
  assert.equal(delOwner.length, 0);
  const delExtra = await ok(await rest("DELETE", `staff?id=eq.${extraStaffId}&business_id=eq.${biz}&role=neq.owner`), "delete staff");
  assert.equal(delExtra.length, 1);
});

test("매장 설정 수정 (settings/actions.ts 와 같은 호출)", async () => {
  const rows = await ok(
    await rest("PATCH", `businesses?id=eq.${biz}`, { name: `흐름매장-${run}(수정)`, phone: "02-0000-0000", address: "부산", naver_booking_id: "nb-1", toss_client_key: "test_ck_x" }),
    "updateBusiness"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, `흐름매장-${run}(수정)`);
});

test("프로필 이름/전화번호 수정", async () => {
  const rows = await ok(await rest("PATCH", `profiles?id=eq.${user.id}`, { full_name: "수정된이름", phone: "010-0000-0000" }), "profile update");
  assert.equal(rows.length, 1);
});

test("고객 CRUD + 등급/태그", async () => {
  const [c] = await ok(await rest("POST", "customers", { business_id: biz, name: "김고객", phone: "01011112222", memo: "메모" }), "add customer");
  customerId = c.id;
  const [g] = await ok(await rest("POST", "customer_grades", { business_id: biz, name: "VIP" }), "grade");
  const [tag] = await ok(await rest("POST", "customer_tags", { business_id: biz, name: "단골" }), "tag");
  await ok(await rest("PATCH", `customers?id=eq.${customerId}&business_id=eq.${biz}`, { grade_id: g.id }), "grade link");
  await ok(await rest("POST", "customer_tag_links", { business_id: biz, customer_id: customerId, tag_id: tag.id }), "tag link");
  await ok(await rest("PATCH", `customers?id=eq.${customerId}&business_id=eq.${biz}`, { memo: "수정된 메모" }), "memo");
});

test("시술/예약/매출 CRUD", async () => {
  const [s] = await ok(await rest("POST", "services", { business_id: biz, name: "커트", duration_minutes: 30, price: 20000 }), "service");
  serviceId = s.id;
  const start = new Date(Date.now() + 86_400_000);
  const [r] = await ok(
    await rest("POST", "reservations", { business_id: biz, customer_id: customerId, service_id: serviceId, start_time: start.toISOString(), end_time: new Date(start.getTime() + 1_800_000).toISOString(), status: "confirmed", source: "internal" }),
    "reservation"
  );
  reservationId = r.id;
  await ok(await rest("PATCH", `reservations?id=eq.${reservationId}&business_id=eq.${biz}`, { status: "completed" }), "reservation status");
  const [pm] = await ok(await rest("GET", `payment_methods?business_id=eq.${biz}&limit=1`), "pm");
  const [p] = await ok(
    await rest("POST", "payments", { business_id: biz, customer_id: customerId, service_id: serviceId, gross_amount: 20000, discount_amount: 0, amount: 20000, method_id: pm.id, status: "paid", paid_at: new Date().toISOString() }),
    "payment"
  );
  assert.equal(p.amount, 20000);
  const del = await ok(await rest("DELETE", `reservations?id=eq.${reservationId}&business_id=eq.${biz}`), "delete reservation");
  assert.equal(del.length, 1);
  // 예약을 지워도 매출/고객은 남는다 (on delete set null 관계)
  assert.equal((await ok(await rest("GET", `customers?id=eq.${customerId}`), "customer")).length, 1);
});

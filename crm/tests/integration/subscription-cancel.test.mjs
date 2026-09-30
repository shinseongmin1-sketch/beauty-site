// 구독 자동결제 해지(013) DB 통합 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 정책: 다음 자동결제만 해지. 현재 이용기간은 그대로(끝까지 쓰기 가능) → 종료 시 expired(cancelled). 결제수단 유지. 재시도 없음.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTarget, mintUserToken } from "../../scripts/lib/env.mjs";

const t = loadTarget("test");
const run = crypto.randomBytes(4).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const SH = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };
const created = [];
const hashOf = (n) => crypto.createHash("sha256").update(`${run}:cancel:${n}`).digest("hex");

const call = async (u, method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { apikey: t.anonKey, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: r.status, ok: r.ok, json, rows: Array.isArray(json) ? json.length : null, message: json?.message ?? "" };
};
const svc = async (method, pq, body, expectOk = true) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { ...SH, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (expectOk) assert.ok(r.ok, `svc ${method} ${pq}: ${r.status} ${text.slice(0, 200)}`);
  return { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : null };
};
async function mkUser(label) {
  const email = `cancel-${run}-${label}@gmail.com`;
  const r = await fetch(`${t.url}/auth/v1/admin/users`, { method: "POST", headers: SH, body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: { full_name: `C-${label}` } }) });
  const j = await r.json();
  assert.ok(r.ok, `create ${label}`);
  created.push(j.id);
  return { id: j.id, email, token: await mintUserToken(t, { id: j.id, email }) };
}
async function mkOwner(label, n) {
  const u = await mkUser(label);
  const b = await call(u, "POST", "rpc/create_my_business", { p_name: `C-${run}-${label}`, p_representative_name: "대표", p_business_number_hash: hashOf(n), p_business_number_masked: "123-**-***45" });
  assert.ok(b.ok, `biz ${label}: ${b.status} ${b.message}`);
  u.biz = b.json;
  await svc("POST", "customers", [{ business_id: u.biz, name: `${label}-고객1` }, { business_id: u.biz, name: `${label}-고객2` }]);
  return u;
}
const sub = async (u) => (await svc("GET", `subscriptions?business_id=eq.${u.biz}&select=*`)).json[0];
const setSub = (u, patch) => svc("PATCH", `subscriptions?business_id=eq.${u.biz}`, patch);
const canWrite = async (u) => { const r = await call(u, "POST", "customers", { business_id: u.biz, name: `w-${crypto.randomBytes(3).toString("hex")}` }); return r.ok && r.rows === 1; };
const attach = async (u, cycle) => {
  const key = (await call(u, "POST", "rpc/billing_customer_key", {})).json;
  return svc("POST", "rpc/billing_attach_method", { p_business: u.biz, p_customer_key: key, p_billing_key_enc: `v1.fake.${crypto.randomBytes(8).toString("hex")}`, p_card_company: "국민", p_card_number_masked: "5585****0000", p_card_type: "신용", p_billing_cycle: cycle });
};
const cancel = (u) => call(u, "POST", "rpc/billing_cancel_auto_renewal", {});
const claimFor = async (u) => ((await svc("POST", "rpc/billing_claim_due", { p_limit: 500 })).json ?? []).filter((r) => r.business_id === u.biz);
const paymentsOf = async (u) => (await svc("GET", `subscription_payments?business_id=eq.${u.biz}&select=id`)).json.length;
const activeMethods = async (u) => (await svc("GET", `subscription_payment_methods?business_id=eq.${u.biz}&status=eq.active&select=id`)).json.length;
const customerCount = async (u) => (await svc("GET", `customers?business_id=eq.${u.biz}&select=id`)).json.length;
const iso = (d) => new Date(d).toISOString();
const ms = (a) => new Date(a).getTime();
const laterToday = (maxMs) => {
  const now = Date.now(); const kst = new Date(now + 9 * 3600_000);
  const mid = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - 9 * 3600_000;
  return new Date(now + Math.max(30_000, Math.min(maxMs, mid - now - 60_000)));
};
const makeActive = (u, cycle, endMs) =>
  setSub(u, { status: "active", billing_cycle: cycle, expired_reason: null, current_period_start: iso(Date.now() - 86_400_000), current_period_end: iso(endMs) });

after(async () => {
  for (const id of created) {
    const p = (await svc("GET", `profiles?id=eq.${id}&select=business_id,role`)).json[0];
    if (p?.business_id && p.role === "owner") await svc("DELETE", `businesses?id=eq.${p.business_id}`, null, false);
    await fetch(`${t.url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: SH });
  }
});

let A, Y, T, N, X, B;

test("A/I/G(1개월). active + 카드 → 자동결제 해지 → canceled, 이용기간 그대로, 즉시 계속 쓰기 가능, 결제수단 유지", async () => {
  A = await mkOwner("a", 1);
  assert.ok((await attach(A, "monthly")).ok);
  const end = Date.now() + 20 * 86_400_000;
  await makeActive(A, "monthly", end);
  assert.equal(await canWrite(A), true);
  const before = await sub(A);
  const r = await cancel(A);
  assert.ok(r.ok, `해지 성공: ${r.status} ${r.message}`);
  assert.equal(r.json.status, "canceled");
  const s = await sub(A);
  assert.equal(s.status, "canceled");
  assert.ok(s.canceled_at, "해지 시각 기록");
  assert.equal(ms(s.current_period_end), ms(before.current_period_end), "이용기간 종료일 변경 없음");
  assert.equal(ms(s.current_period_start), ms(before.current_period_start), "이용기간 시작 변경 없음");
  assert.equal(await canWrite(A), true, "해지 직후에도 쓰기 가능 (기존 종료일까지)");
  const upd = await call(A, "PATCH", `customers?business_id=eq.${A.biz}&name=eq.a-고객1`, { memo: "해지 후 수정" });
  assert.ok(upd.ok && upd.rows === 1, "수정도 가능");
  assert.equal(await activeMethods(A), 1, "I. 결제수단(빌링키) 삭제되지 않음");
  assert.equal(s.payment_method_id, before.payment_method_id);
});

test("F. 이미 canceled → 다시 해지해도 중복 처리 없음 (canceled_at·기간 그대로)", async () => {
  const s0 = await sub(A);
  const r = await cancel(A);
  assert.ok(r.ok);
  assert.equal(r.json.already_canceled, true);
  const s1 = await sub(A);
  assert.equal(s1.canceled_at, s0.canceled_at);
  assert.equal(ms(s1.current_period_end), ms(s0.current_period_end));
  assert.equal(s1.updated_at, s0.updated_at, "행이 다시 갱신되지 않음");
});

test("B/E. 해지된 구독 → 결제일(오늘 종료)에 스케줄러 여러 번 실행해도 결제 대상 아님, 결제 기록 없음", async () => {
  await setSub(A, { current_period_end: iso(laterToday(60 * 60_000)) });
  assert.equal(await canWrite(A), true, "결제일에도 종료 전까지 쓰기 가능");
  for (let i = 0; i < 3; i++) assert.equal((await claimFor(A)).length, 0, `실행 ${i + 1}: 대상 아님`);
  assert.equal(await paymentsOf(A), 0, "결제 기록 생성 없음");
  assert.equal((await sub(A)).status, "canceled");
});

test("C. 해지된 구독의 이용기간 종료 → expired(cancelled) + 쓰기 차단 + 데이터 유지 + 결제수단 유지", async () => {
  const cnt = await customerCount(A);
  await setSub(A, { current_period_end: iso(Date.now() - 60_000) });
  assert.equal(await canWrite(A), false, "종료 시각이 지나면 상태 동기화 전에도 즉시 쓰기 차단");
  const n = await svc("POST", "rpc/expire_ended_cancellations", {});
  assert.ok(n.json >= 1);
  const s = await sub(A);
  assert.equal(s.status, "expired");
  assert.equal(s.expired_reason, "cancelled");
  assert.equal(await canWrite(A), false);
  assert.equal(await customerCount(A), cnt, "데이터 유지");
  const read = await call(A, "GET", `customers?business_id=eq.${A.biz}&select=id`);
  assert.ok(read.ok && read.rows === cnt, "조회 가능");
  assert.equal(await activeMethods(A), 1, "결제수단은 삭제하지 않음");
  assert.equal((await claimFor(A)).length, 0, "만료 후에도 자동결제 없음");
});

test("H. expired 구독 해지 시도 → 거부 (결제 실패 만료 / 해지 만료 모두)", async () => {
  const r = await cancel(A);
  assert.equal(r.ok, false);
  assert.match(r.message, /not_cancellable/);
  X = await mkOwner("x", 5);
  await attach(X, "monthly");
  await setSub(X, { status: "expired", expired_reason: "payment_failed" });
  const r2 = await cancel(X);
  assert.equal(r2.ok, false);
  assert.match(r2.message, /not_cancellable/);
  assert.equal((await sub(X)).status, "expired");
});

test("H(12개월). 연간 active → 해지 → 기존 종료일(약 10개월 뒤)까지 사용 가능", async () => {
  Y = await mkOwner("y", 2);
  await attach(Y, "yearly");
  const end = Date.now() + 300 * 86_400_000;
  await makeActive(Y, "yearly", end);
  const r = await cancel(Y);
  assert.ok(r.ok);
  const s = await sub(Y);
  assert.equal(s.status, "canceled");
  assert.equal(s.billing_cycle, "yearly");
  assert.equal(ms(s.current_period_end), ms(iso(end)), "연간 종료일 그대로");
  assert.equal(await canWrite(Y), true);
});

test("D. trial + 카드 → 해지 → 체험 종료까지 사용, 체험 종료 시 자동결제 없음 → expired(cancelled)", async () => {
  T = await mkOwner("t", 3);
  await attach(T, "monthly");
  const trialEnd = laterToday(90 * 60_000);
  await setSub(T, { trial_ends_at: iso(trialEnd) });
  const r = await cancel(T);
  assert.ok(r.ok, `${r.status} ${r.message}`);
  const s = await sub(T);
  assert.equal(s.status, "canceled");
  assert.equal(ms(s.current_period_end), ms(trialEnd), "이용 가능 기간 = 체험 종료 시각");
  assert.equal(await canWrite(T), true, "체험 종료 전까지 쓰기 가능");
  assert.equal((await claimFor(T)).length, 0, "체험 종료일(오늘)인데도 자동결제 대상 아님");
  assert.equal(await paymentsOf(T), 0);
  await setSub(T, { trial_ends_at: iso(Date.now() - 60_000), current_period_end: iso(Date.now() - 60_000) });
  await call(T, "POST", "rpc/sync_my_subscription", {}); // 화면 진입 동기화 경로
  const s2 = await sub(T);
  assert.equal(s2.status, "expired");
  assert.equal(s2.expired_reason, "cancelled");
  assert.equal(await canWrite(T), false);
  assert.equal((await claimFor(T)).length, 0);
  assert.equal(await paymentsOf(T), 0, "결제 기록 없음");
});

test("G. 카드 없는 trial 해지 시도 → 거부 (해지할 자동결제 없음)", async () => {
  N = await mkOwner("n", 4);
  const r = await cancel(N);
  assert.equal(r.ok, false);
  assert.match(r.message, /not_cancellable/);
  assert.equal((await sub(N)).status, "trial");
  assert.equal(await canWrite(N), true);
});

test("I(권한). 같은 매장 직원·관리자 해지 시도 → 거부", async () => {
  B = await mkOwner("b", 6);
  await attach(B, "monthly");
  await makeActive(B, "monthly", Date.now() + 20 * 86_400_000);
  for (const role of ["staff", "manager"]) {
    const u = await mkUser(role);
    await svc("PATCH", `profiles?id=eq.${u.id}`, { business_id: B.biz, role });
    const r = await cancel(u);
    assert.equal(r.ok, false, `${role} 거부`);
    assert.match(r.message, /forbidden/);
  }
  assert.equal((await sub(B)).status, "active", "직원 시도 후에도 active");
});

test("J/K. 다른 매장 ID 조작·직접 조작 우회 → 거부", async () => {
  // J: 매장 ID 를 넣어 호출 → 그런 인자를 받는 함수가 없어 실패, B 는 그대로
  const j1 = await call(Y, "POST", "rpc/billing_cancel_auto_renewal", { p_business: B.biz });
  assert.equal(j1.ok, false, "매장 ID 인자 호출 실패");
  assert.equal((await sub(B)).status, "active", "다른 매장(B) 구독 변화 없음");
  // 자기 매장을 해지하는 경로로는 자기 매장만 영향 (Y 는 이미 canceled → 중복 처리 없음)
  // K: 브라우저 권한으로 구독 상태 직접 변경 / 서버 전용 함수 호출
  const k1 = await call(B, "PATCH", `subscriptions?business_id=eq.${B.biz}`, { status: "canceled" });
  const k2 = await call(B, "PATCH", `subscriptions?business_id=eq.${Y.biz}`, { status: "canceled" });
  const k3 = await call(B, "POST", "rpc/expire_ended_cancellations", { p_business: Y.biz });
  const k4 = await call(Y, "PATCH", `subscriptions?business_id=eq.${Y.biz}`, { status: "active", current_period_end: iso(Date.now() + 999 * 86_400_000) });
  for (const [name, r] of Object.entries({ "자기 구독 status 직접 변경": k1, "다른 매장 구독 변경": k2, "만료 처리 함수 호출": k3, "해지 상태를 active 로 되돌리기": k4 })) {
    assert.ok(!r.ok || r.rows === 0, `${name}: 차단되어야 함 (${r.status})`);
  }
  assert.equal((await sub(B)).status, "active");
  assert.equal((await sub(Y)).status, "canceled");
  // 해지 함수는 해지만: 이미 canceled 인 Y 를 다시 호출해도 active 가 되거나 기간이 늘지 않음
  const y0 = await sub(Y);
  await cancel(Y);
  const y1 = await sub(Y);
  assert.equal(y1.status, "canceled");
  assert.equal(ms(y1.current_period_end), ms(y0.current_period_end));
});

test("해지 후 만료(expired cancelled) → 기존 직접 결제 경로로 다시 이용 가능 (재활성화 버튼 없이 기존 정책)", async () => {
  const [row] = (await svc("POST", "rpc/billing_start_manual", { p_business: A.biz, p_cycle: "monthly" })).json;
  assert.equal(row.amount, 10000);
  const rec = await svc("POST", "rpc/billing_record_result", { p_payment_id: row.payment_id, p_success: true, p_toss_payment_key: "tpk_test", p_approved_at: null, p_failure_code: null, p_failure_message: null });
  assert.equal(rec.json.status, "paid");
  const s = await sub(A);
  assert.equal(s.status, "active");
  assert.equal(s.expired_reason, null);
  assert.equal(await canWrite(A), true);
});

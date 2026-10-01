// 구독 자동결제(012) DB 통합 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 정책: 유예 없음. 자동결제 실패 → 즉시 expired(payment_failed) / 직접 결제 성공 → 결제 시각부터 새 기간 / 자동결제 성공 → 이어서 연장.
// 토스 호출은 앱 서버 몫이라 여기서는 "검증된 결과를 받았다고 가정"하고 service_role 전용 함수(billing_record_result)로 반영한다.
// 브라우저 권한(실제 사용자 JWT)으로는 상태를 바꿀 수 없는지(우회 불가)를 함께 확인한다.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTarget, mintUserToken } from "../../scripts/lib/env.mjs";

const t = loadTarget("test");
const CONSENT = "test-consent-v1";
const run = crypto.randomBytes(4).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const SH = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };
const created = [];
const hashOf = (n) => crypto.createHash("sha256").update(`${run}:bill:${n}`).digest("hex");

async function mkOwner(label, n) {
  const email = `bill-${run}-${label}@gmail.com`;
  const r = await fetch(`${t.url}/auth/v1/admin/users`, { method: "POST", headers: SH, body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: { full_name: `B-${label}` } }) });
  const j = await r.json();
  assert.ok(r.ok, `create ${label}`);
  created.push(j.id);
  const u = { id: j.id, email, token: await mintUserToken(t, { id: j.id, email }) };
  const b = await call(u, "POST", "rpc/create_my_business", { p_name: `B-${run}-${label}`, p_representative_name: "대표", p_business_number_hash: hashOf(n), p_business_number_masked: "123-**-***45" });
  assert.ok(b.ok, `biz ${label}: ${b.status} ${b.message}`);
  u.biz = b.json;
  return u;
}
const call = async (u, method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { apikey: t.anonKey, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: r.status, ok: r.ok, json, rows: Array.isArray(json) ? json.length : null, code: json?.code, message: json?.message ?? "" };
};
const svc = async (method, pq, body, expectOk = true) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { ...SH, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (expectOk) assert.ok(r.ok, `svc ${method} ${pq}: ${r.status} ${text.slice(0, 200)}`);
  return { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : null };
};
const rpcSvc = (fn, args, expectOk = true) => svc("POST", `rpc/${fn}`, args, expectOk);
const sub = async (u) => (await svc("GET", `subscriptions?business_id=eq.${u.biz}&select=*`)).json[0];
const setSub = (u, patch) => svc("PATCH", `subscriptions?business_id=eq.${u.biz}`, patch);
const canWrite = async (u) => {
  const r = await call(u, "POST", "customers", { business_id: u.biz, name: `w-${crypto.randomBytes(3).toString("hex")}` });
  return r.ok && r.rows === 1;
};
const customerKeyOf = async (u) => (await call(u, "POST", "rpc/billing_customer_key", {})).json;
const attach = async (u, cycle) =>
  rpcSvc("billing_attach_method", { p_business: u.biz, p_customer_key: await customerKeyOf(u), p_billing_key_enc: `v1.fake.${crypto.randomBytes(8).toString("hex")}`, p_card_company: "국민", p_card_number_masked: "5585****0000", p_card_type: "신용", p_billing_cycle: cycle, p_consent_version: CONSENT });
const claimFor = async (u) => ((await rpcSvc("billing_claim_due", { p_limit: 500 })).json ?? []).filter((r) => r.business_id === u.biz);
const record = (paymentId, success, approvedAt = null) =>
  rpcSvc("billing_record_result", { p_payment_id: paymentId, p_success: success, p_toss_payment_key: success ? `tpk_${crypto.randomBytes(6).toString("hex")}` : null, p_approved_at: approvedAt, p_failure_code: success ? null : "NOT_SUPPORTED_CARD_TYPE", p_failure_message: success ? null : "테스트 실패" });
const iso = (d) => new Date(d).toISOString();
const ms = (a) => new Date(a).getTime();
const monthAfter = (d) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + 1); return x; };

after(async () => {
  for (const id of created) {
    const p = (await svc("GET", `profiles?id=eq.${id}&select=business_id`)).json[0];
    if (p?.business_id) await svc("DELETE", `businesses?id=eq.${p.business_id}`, null, false);
    await fetch(`${t.url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: SH });
  }
});

let A, B, C;

// 오늘(한국 날짜) 안에서 "지금 + 최대 2시간" (결제일 = 오늘이 되도록). 자정 직전이면 남은 시간 안으로 줄인다.
const laterToday = (maxMs = 2 * 3600_000) => {
  const now = Date.now();
  const kst = new Date(now + 9 * 3600_000);
  const kstMidnightUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - 9 * 3600_000;
  return new Date(now + Math.max(30_000, Math.min(maxMs, kstMidnightUtc - now - 60_000)));
};
// 자동결제 성공 반영 + "결제 성공 시각" 범위(반영 호출 전후)를 함께 돌려준다
const recordTimed = async (paymentId) => {
  const t0 = Date.now() - 5000; // DB 서버 시계와의 차이 여유 5초
  const r = await record(paymentId, true);
  const t1 = Date.now() + 5000;
  return { r, t0, t1 };
};

test("A. 무료체험(종료 시각 미래) → 종료 전 자동결제 성공 → 즉시 active·쓰기 가능, 시작=결제 성공 시각, 종료=체험 종료+1개월", async () => {
  A = await mkOwner("a", 1);
  assert.ok((await attach(A, "monthly")).ok);
  const trialEnd = laterToday();
  await setSub(A, { trial_ends_at: iso(trialEnd) });
  assert.equal(await canWrite(A), true, "체험 중이라 결제 전에도 쓰기 가능");
  const [row] = await claimFor(A);
  assert.ok(row, "체험 종료일(오늘)이라 결제 대상");
  assert.equal(row.amount, 10000);
  const again = await claimFor(A);
  assert.equal(again.length, 1, "같은 결제 대상이 두 번 만들어지지 않음 (재실행은 같은 pending 재확인)");
  assert.equal(again[0].payment_id, row.payment_id);
  const { r, t0, t1 } = await recordTimed(row.payment_id);
  assert.equal(r.json.status, "paid");
  const s = await sub(A);
  assert.equal(s.status, "active");
  const start = ms(s.current_period_start);
  assert.ok(start >= t0 && start <= t1, `시작 = 결제 성공 시각이어야 함 (start=${s.current_period_start})`);
  assert.ok(start < ms(trialEnd), "체험 종료 시각보다 앞 (미리 결제돼도 공백 없음)");
  assert.equal(ms(s.current_period_end), ms(monthAfter(trialEnd)), "종료 = 기존 체험 종료 시각 + 1개월");
  assert.equal(s.expired_reason, null);
  assert.equal(await canWrite(A), true, "결제 성공 즉시 쓰기 가능");
  console.log(`  [A 확인] 결제 성공 시각→시작: ${s.current_period_start} / 체험 종료(연장 기준): ${iso(trialEnd)} → 종료: ${s.current_period_end}`);
});

test("A-2. 체험이 이미 끝난 뒤(결제일 경과) 자동결제 성공 → 시작=결제 성공 시각, 종료=체험 종료+1개월", async () => {
  const X = await mkOwner("a2", 11);
  assert.ok((await attach(X, "monthly")).ok);
  const trialEnd = new Date(Date.now() - 60_000);
  await setSub(X, { trial_ends_at: iso(trialEnd) });
  assert.equal(await canWrite(X), false, "체험 종료 후 결제 전에는 쓰기 불가");
  await call(X, "POST", "rpc/sync_my_subscription", {});
  assert.equal((await sub(X)).status, "trial", "카드가 있는 체험은 sync 로 expired 가 되지 않음 (자동결제가 처리)");
  const [row] = await claimFor(X);
  const { r, t0, t1 } = await recordTimed(row.payment_id);
  assert.equal(r.json.status, "paid");
  const s = await sub(X);
  assert.ok(ms(s.current_period_start) >= t0 && ms(s.current_period_start) <= t1, "시작 = 결제 성공 시각");
  assert.equal(ms(s.current_period_end), ms(monthAfter(trialEnd)), "종료 = 체험 종료 + 1개월");
  assert.equal(await canWrite(X), true);
});

test("C. active → 기존 기간 종료 전 자동결제 성공 → 즉시 쓰기 가능, 시작=결제 성공 시각, 종료=기존 종료+1개월 (공백 없음)", async () => {
  const s0 = await sub(A);
  const end = laterToday(60 * 60_000);
  const start0 = new Date(end.getTime() - 30 * 86_400_000);
  await setSub(A, { current_period_start: iso(start0), current_period_end: iso(end) });
  assert.equal(await canWrite(A), true, "기존 기간 안");
  const [row] = await claimFor(A);
  assert.ok(row, "결제일(오늘)인 구독이 대상");
  const { r, t0, t1 } = await recordTimed(row.payment_id);
  assert.equal(r.json.status, "paid");
  const s = await sub(A);
  assert.equal(s.status, "active");
  assert.equal(s.id, s0.id);
  const start = ms(s.current_period_start);
  assert.ok(start >= t0 && start <= t1, `시작 = 결제 성공 시각 (start=${s.current_period_start})`);
  assert.ok(start <= Date.now() && start < ms(end), "새 시작 ≤ 지금 < 기존 종료 → 공백 없음");
  assert.equal(ms(s.current_period_end), ms(monthAfter(end)), "종료 = 기존 종료 + 1개월 (결제 시각 기준 재설정 아님)");
  assert.equal(await canWrite(A), true, "결제 성공 즉시 쓰기 가능");
  const [pay] = (await svc("GET", `subscription_payments?id=eq.${row.payment_id}&select=due_at,period_start,period_end`)).json;
  assert.equal(ms(pay.due_at), ms(end), "결제 기록에 연장 기준(기존 종료 시각) 보존");
  console.log(`  [C 확인] 결제 성공 시각→시작: ${s.current_period_start} / 기존 종료(연장 기준): ${iso(end)} → 새 종료: ${s.current_period_end}`);
  // 같은 결제를 두 번 반영해도 기간이 또 늘어나지 않는다 (멱등)
  const dup = await record(row.payment_id, true);
  assert.equal(dup.json.already_recorded, true);
  assert.equal(ms((await sub(A)).current_period_end), ms(monthAfter(end)));
});

test("D. active → 자동결제 실패 → 즉시 expired(payment_failed) → 유료 기능 차단 (유예 없음)", async () => {
  const end = laterToday(30 * 60_000);
  await setSub(A, { current_period_start: iso(end.getTime() - 30 * 86_400_000), current_period_end: iso(end) });
  assert.equal(await canWrite(A), true, "실패 전(이용기간 안)에는 쓰기 가능");
  const [row] = await claimFor(A);
  assert.equal((await record(row.payment_id, false)).json.status, "failed");
  const s = await sub(A);
  assert.equal(s.status, "expired");
  assert.equal(s.expired_reason, "payment_failed");
  assert.equal(await canWrite(A), false, "실패 즉시 차단 (이용기간이 30분 남아 있어도)");
  const upd = await call(A, "PATCH", `customers?business_id=eq.${A.biz}`, { memo: "x" });
  assert.ok(!upd.ok || upd.rows === 0, "수정 차단");
  const del = await call(A, "DELETE", `customers?business_id=eq.${A.biz}`);
  assert.ok(!del.ok || del.rows === 0, "삭제 차단");
  // 재시도 없음: 다음 스케줄러 실행에서 다시 결제 대상이 되지 않는다
  assert.equal((await claimFor(A)).length, 0);
});

test("F. expired 상태에서 기존 데이터 유지 + 조회 가능", async () => {
  const r = await call(A, "GET", `customers?business_id=eq.${A.biz}&select=id`);
  assert.ok(r.ok);
  assert.ok(r.rows >= 2, `기존 고객 데이터가 남아 있어야 함 (현재 ${r.rows})`);
  const pays = await call(A, "GET", `subscription_payments?select=status&order=requested_at`);
  assert.deepEqual(pays.json.map((p) => p.status), ["paid", "paid", "failed"], "대표는 자기 결제 내역을 조회");
});

test("G/H. 차단 상태 우회·결제 결과 조작 불가 (사용자 JWT 로 직접 API 호출)", async () => {
  const [pay] = (await svc("GET", `subscription_payments?business_id=eq.${A.biz}&status=eq.failed&select=id`)).json;
  const attempts = {
    "구독 상태 직접 변경": await call(A, "PATCH", `subscriptions?business_id=eq.${A.biz}`, { status: "active", current_period_start: iso(Date.now()), current_period_end: iso(Date.now() + 86_400_000 * 30) }),
    "결제 결과 반영 함수": await call(A, "POST", "rpc/billing_record_result", { p_payment_id: pay.id, p_success: true, p_toss_payment_key: "fake", p_approved_at: null, p_failure_code: null, p_failure_message: null }),
    "직접 결제 시작 함수": await call(A, "POST", "rpc/billing_start_manual", { p_business: A.biz, p_cycle: "monthly" }),
    "결제 대상 확보 함수": await call(A, "POST", "rpc/billing_claim_due", { p_limit: 1 }),
    "결제수단 연결 함수": await call(A, "POST", "rpc/billing_attach_method", { p_business: A.biz, p_customer_key: "x", p_billing_key_enc: "x", p_card_company: null, p_card_number_masked: null, p_card_type: null, p_billing_cycle: "monthly" }),
    "결제 기록 직접 추가": await call(A, "POST", "subscription_payments", { business_id: A.biz, subscription_id: (await sub(A)).id, kind: "manual", billing_cycle: "monthly", amount: 10000, supply_amount: 9091, vat_amount: 909, order_id: `hack_${run}`, status: "paid" }),
    "결제 기록 상태 변경": await call(A, "PATCH", `subscription_payments?id=eq.${pay.id}`, { status: "paid" }),
    "결제수단(빌링키) 조회": await call(A, "GET", `subscription_payment_methods?select=billing_key_enc`),
  };
  for (const [name, r] of Object.entries(attempts)) {
    const blocked = !r.ok || r.rows === 0 || (Array.isArray(r.json) && r.json.length === 0);
    assert.ok(blocked, `${name}: 차단되어야 함 (${r.status} ${r.message})`);
  }
  const s = await sub(A);
  assert.equal(s.status, "expired", "여전히 expired");
  assert.equal(await canWrite(A), false);
  // 결제 금액은 DB 에서도 고정: 서버(service_role)라도 다른 금액으로는 결제 기록을 만들 수 없다
  const bad = await svc("POST", "subscription_payments", { business_id: A.biz, subscription_id: s.id, kind: "manual", billing_cycle: "monthly", amount: 100, supply_amount: 91, vat_amount: 9, order_id: `bad_${run}` }, false);
  assert.equal(bad.ok, false, "금액 조작 결제 기록 거부");
});

test("E. expired → 직접 결제 성공 → 즉시 active, 결제 성공 시각부터 새 기간 (연간)", async () => {
  const before = await sub(A);
  const [row] = (await rpcSvc("billing_start_manual", { p_business: A.biz, p_cycle: "yearly", p_consent_version: CONSENT })).json;
  assert.equal(row.amount, 110000);
  const dupStart = await rpcSvc("billing_start_manual", { p_business: A.biz, p_cycle: "yearly", p_consent_version: CONSENT }, false);
  assert.equal(dupStart.ok, false, "진행 중인 결제가 있으면 두 번째 결제 시작 거부");
  const approvedAt = new Date(Date.now() - 5_000);
  assert.equal((await record(row.payment_id, true, iso(approvedAt))).json.status, "paid");
  const s = await sub(A);
  assert.equal(s.status, "active");
  assert.equal(s.billing_cycle, "yearly");
  assert.equal(ms(s.current_period_start), ms(approvedAt), "결제 성공 시각부터 시작 (이전 만료/실패 시각 아님)");
  const y = new Date(approvedAt); y.setUTCFullYear(y.getUTCFullYear() + 1);
  assert.equal(ms(s.current_period_end), ms(y));
  assert.notEqual(ms(s.current_period_start), ms(before.current_period_end));
  assert.equal(s.expired_reason, null);
  assert.equal(await canWrite(A), true, "즉시 쓰기 가능");
  const again = await rpcSvc("billing_start_manual", { p_business: A.biz, p_cycle: "monthly", p_consent_version: CONSENT }, false);
  assert.equal(again.ok, false, "이용 중이면 직접 결제를 받지 않음 (중복 결제 방지)");
});

test("B. 무료체험 종료 → 자동결제 실패 → 즉시 expired(payment_failed) → 차단, 데이터 유지", async () => {
  B = await mkOwner("b", 2);
  assert.ok(await canWrite(B));
  assert.ok((await attach(B, "yearly")).ok);
  await setSub(B, { trial_ends_at: iso(laterToday(10 * 60_000)) }); // 오늘 체험 종료 (결제일)
  const [row] = await claimFor(B);
  assert.equal(row.amount, 110000);
  await record(row.payment_id, false);
  const s = await sub(B);
  assert.equal(s.status, "expired");
  assert.equal(s.expired_reason, "payment_failed");
  assert.equal(await canWrite(B), false, "체험 시간이 남아 있어도 결제 실패 즉시 차단");
  assert.equal((await call(B, "GET", `customers?business_id=eq.${B.biz}&select=id`)).rows, 1, "데이터 유지");
});

test("카드 없는 무료체험 종료 → expired(trial_expired) (기존 정책 유지)", async () => {
  C = await mkOwner("c", 3);
  await setSub(C, { trial_ends_at: iso(Date.now() - 60_000) });
  await call(C, "POST", "rpc/sync_my_subscription", {});
  const s = await sub(C);
  assert.equal(s.status, "expired");
  assert.equal(s.expired_reason, "trial_expired");
  assert.equal(await canWrite(C), false);
});

test("결제수단: 다른 매장 customerKey 로 연결 불가, 교체 시 이전 카드 반환, 빌링키는 대표도 조회 불가", async () => {
  const other = await customerKeyOf(B);
  const wrong = await rpcSvc("billing_attach_method", { p_business: C.biz, p_customer_key: other, p_billing_key_enc: "v1.x.y.z", p_card_company: null, p_card_number_masked: null, p_card_type: null, p_billing_cycle: "monthly", p_consent_version: CONSENT }, false);
  assert.equal(wrong.ok, false, "다른 매장 customerKey 거부");
  const first = await attach(C, "monthly");
  const second = await attach(C, "monthly");
  assert.ok(first.json.method_id && second.json.replaced_billing_key_enc, "교체 시 이전 빌링키(암호문) 반환 → 앱이 토스에서 삭제");
  const card = await call(C, "POST", "rpc/billing_my_payment_method", {});
  assert.equal(card.json.length, 1);
  assert.deepEqual(Object.keys(card.json[0]).sort(), ["card_company", "card_number_masked", "card_type", "created_at"], "화면용 요약에는 빌링키/customerKey 없음");
  const staffView = await call(C, "GET", "subscription_payment_methods?select=*");
  assert.ok(!staffView.ok || staffView.rows === 0);
});

test("business_is_writable: active 라도 이용기간 밖이면 쓰기 불가", async () => {
  await setSub(C, { status: "active", expired_reason: null, current_period_start: iso(Date.now() - 40 * 86_400_000), current_period_end: iso(Date.now() - 60_000) });
  assert.equal(await canWrite(C), false, "기간 종료된 active");
  await setSub(C, { current_period_start: iso(Date.now() + 86_400_000), current_period_end: iso(Date.now() + 40 * 86_400_000) });
  assert.equal(await canWrite(C), false, "시작 전 active");
  await setSub(C, { current_period_start: iso(Date.now() - 60_000), current_period_end: iso(Date.now() + 86_400_000) });
  assert.equal(await canWrite(C), true, "기간 안 active");
});

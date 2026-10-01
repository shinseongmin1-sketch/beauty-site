// 자동결제 동의 기록(015) + 직접 결제 pending 조회(014) DB 통합 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 토스 조회/결제는 앱 서버 몫(앱 테스트에서 검증). 여기서는 DB 규칙(동의 필수·기록 위치·조작 불가, pending 조회·재결제 차단)을 본다.
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
const hashOf = (n) => crypto.createHash("sha256").update(`${run}:consent:${n}`).digest("hex");

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
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { ok: r.ok, status: r.status, json, message: json?.message ?? "" };
};
async function mkUser(label) {
  const email = `consent-${run}-${label}@gmail.com`;
  const r = await fetch(`${t.url}/auth/v1/admin/users`, { method: "POST", headers: SH, body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: { full_name: `K-${label}` } }) });
  const j = await r.json();
  assert.ok(r.ok);
  created.push(j.id);
  return { id: j.id, email, token: await mintUserToken(t, { id: j.id, email }) };
}
async function mkOwner(label, n) {
  const u = await mkUser(label);
  const b = await call(u, "POST", "rpc/create_my_business", { p_name: `K-${run}-${label}`, p_representative_name: "대표", p_business_number_hash: hashOf(n), p_business_number_masked: "123-**-***45" });
  assert.ok(b.ok, `${b.status} ${b.message}`);
  u.biz = b.json;
  return u;
}
const sub = async (u) => (await svc("GET", `subscriptions?business_id=eq.${u.biz}&select=*`)).json[0];
const setSub = (u, patch) => svc("PATCH", `subscriptions?business_id=eq.${u.biz}`, patch);
const keyOf = async (u) => (await call(u, "POST", "rpc/billing_customer_key", {})).json;
const attach = async (u, consent, expectOk = true) =>
  svc("POST", "rpc/billing_attach_method", { p_business: u.biz, p_customer_key: await keyOf(u), p_billing_key_enc: `v1.fake.${crypto.randomBytes(8).toString("hex")}`, p_card_company: "국민", p_card_number_masked: "5585****0000", p_card_type: "신용", p_billing_cycle: "monthly", p_consent_version: consent }, expectOk);
const claimFor = async (u) => ((await svc("POST", "rpc/billing_claim_due", { p_limit: 500 })).json ?? []).filter((r) => r.business_id === u.biz);
const iso = (d) => new Date(d).toISOString();
const ms = (a) => new Date(a).getTime();
const laterToday = (maxMs) => {
  const now = Date.now(); const kst = new Date(now + 9 * 3600_000);
  const mid = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - 9 * 3600_000;
  return new Date(now + Math.max(30_000, Math.min(maxMs, mid - now - 60_000)));
};

after(async () => {
  for (const id of created) {
    const p = (await svc("GET", `profiles?id=eq.${id}&select=business_id,role`)).json[0];
    if (p?.business_id && p.role === "owner") await svc("DELETE", `businesses?id=eq.${p.business_id}`, null, false);
    await fetch(`${t.url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: SH });
  }
});

let O, P;

test("A-3. 대표 정상 동의 → 카드 연결과 함께 동의 시각·버전 저장 (기존 행은 null)", async () => {
  O = await mkOwner("o", 1);
  const s0 = await sub(O);
  assert.equal(s0.auto_renew_consented_at, null, "기존/카드 없는 구독은 동의 기록 없음(null)");
  assert.equal(s0.auto_renew_consent_version, null);
  const t0 = Date.now() - 5000;
  assert.ok((await attach(O, CONSENT)).ok);
  const s = await sub(O);
  assert.ok(ms(s.auto_renew_consented_at) >= t0 && ms(s.auto_renew_consented_at) <= Date.now() + 5000, "동의 시각 = 서버 기록 시각");
  assert.equal(s.auto_renew_consent_version, CONSENT);
});

test("A-3. 동의 없이 자동결제 설정 시도 → 거부 (카드 연결·직접 결제 시작 모두), 기록 변화 없음", async () => {
  const before = await sub(O);
  for (const bad of [null, "", "x", "버전 한글", "a".repeat(41)]) {
    const r = await attach(O, bad, false);
    assert.equal(r.ok, false, `동의 버전 ${JSON.stringify(bad)} 거부`);
  }
  const after1 = await sub(O);
  assert.equal(after1.auto_renew_consented_at, before.auto_renew_consented_at, "거부된 시도는 동의 기록을 바꾸지 않음");
  assert.equal(after1.payment_method_id, before.payment_method_id, "카드도 바뀌지 않음");
  await setSub(O, { status: "expired", expired_reason: "payment_failed" });
  const m = await svc("POST", "rpc/billing_start_manual", { p_business: O.biz, p_cycle: "monthly", p_consent_version: null }, false);
  assert.equal(m.ok, false);
  assert.match(m.message, /consent_required/);
  const old = await svc("POST", "rpc/billing_start_manual", { p_business: O.biz, p_cycle: "monthly" }, false);
  assert.equal(old.ok, false, "동의 인자 없는 예전 호출 형태는 존재하지 않음");
});

test("A-3. 대표·직원 모두 동의 기록을 직접 만들거나 바꿀 수 없음 (브라우저 권한)", async () => {
  const staff = await mkUser("staff");
  await svc("PATCH", `profiles?id=eq.${staff.id}`, { business_id: O.biz, role: "staff" });
  const before = await sub(O);
  const tries = {
    "대표: 동의 시각/버전 직접 수정": await call(O, "PATCH", `subscriptions?business_id=eq.${O.biz}`, { auto_renew_consented_at: iso(Date.now()), auto_renew_consent_version: "forged-v9" }),
    "직원: 동의 기록 직접 수정": await call(staff, "PATCH", `subscriptions?business_id=eq.${O.biz}`, { auto_renew_consent_version: "forged-v9" }),
    "직원: 카드 연결 함수로 동의 기록 생성": await call(staff, "POST", "rpc/billing_attach_method", { p_business: O.biz, p_customer_key: "x", p_billing_key_enc: "x", p_card_company: null, p_card_number_masked: null, p_card_type: null, p_billing_cycle: "monthly", p_consent_version: "forged-v9" }),
    "대표: 직접 결제 시작 함수로 동의 기록": await call(O, "POST", "rpc/billing_start_manual", { p_business: O.biz, p_cycle: "monthly", p_consent_version: "forged-v9" }),
  };
  for (const [name, r] of Object.entries(tries)) assert.ok(!r.ok || r.rows === 0, `${name}: 차단되어야 함 (${r.status})`);
  const s = await sub(O);
  assert.equal(s.auto_renew_consent_version, before.auto_renew_consent_version);
  assert.equal(s.auto_renew_consented_at, before.auto_renew_consented_at);
});

test("A-3. 동의 기록 없는 카드(이전 데이터 가정)는 자동결제하지 않고, 체험 종료 시 카드 없는 체험처럼 expired(trial_expired)", async () => {
  P = await mkOwner("p", 2);
  assert.ok((await attach(P, CONSENT)).ok);
  await setSub(P, { auto_renew_consented_at: null, auto_renew_consent_version: null, trial_ends_at: iso(laterToday(60 * 60_000)) });
  assert.equal((await claimFor(P)).length, 0, "동의 없는 구독은 결제일에도 대상 아님");
  await setSub(P, { trial_ends_at: iso(Date.now() - 60_000) });
  await call(P, "POST", "rpc/sync_my_subscription", {});
  const s = await sub(P);
  assert.equal(s.status, "expired");
  assert.equal(s.expired_reason, "trial_expired");
  assert.equal((await svc("GET", `subscription_payments?business_id=eq.${P.biz}&select=id`)).json.length, 0);
});

test("A-3. 차단 상태 직접 결제 시작 → 결제하기 화면의 동의로 동의 기록 갱신", async () => {
  // O 는 위에서 expired(payment_failed). 직접 결제 시작 시 동의 시각/버전이 새로 기록된다.
  const before = await sub(O);
  const r = await svc("POST", "rpc/billing_start_manual", { p_business: O.biz, p_cycle: "yearly", p_consent_version: "test-consent-v2" });
  assert.equal(r.json[0].amount, 110000);
  const s = await sub(O);
  assert.equal(s.auto_renew_consent_version, "test-consent-v2");
  assert.ok(ms(s.auto_renew_consented_at) >= ms(before.auto_renew_consented_at));
});

test("A-2. 결과 미확정 직접 결제(pending) 조회 함수: 서버 전용, 매장·경과 시간 필터, pending 중 새 결제 시작 거부", async () => {
  // O 에는 위 테스트가 만든 pending(manual) 1건이 있다
  const list = (await svc("POST", "rpc/billing_pending_manual", { p_business: O.biz, p_min_age_seconds: 0 })).json;
  assert.equal(list.length, 1);
  assert.equal(list[0].amount, 110000);
  const young = (await svc("POST", "rpc/billing_pending_manual", { p_business: O.biz, p_min_age_seconds: 3600 })).json;
  assert.equal(young.length, 0, "경과 시간 필터");
  const other = (await svc("POST", "rpc/billing_pending_manual", { p_business: P.biz, p_min_age_seconds: 0 })).json;
  assert.equal(other.length, 0, "다른 매장 것은 나오지 않음");
  const userCall = await call(O, "POST", "rpc/billing_pending_manual", { p_business: O.biz, p_min_age_seconds: 0 });
  assert.equal(userCall.ok, false, "브라우저 권한으로 호출 불가");
  const dup = await svc("POST", "rpc/billing_start_manual", { p_business: O.biz, p_cycle: "monthly", p_consent_version: CONSENT }, false);
  assert.equal(dup.ok, false);
  assert.match(dup.message, /payment_in_progress/, "pending 이 확정되기 전 새 결제 시작 차단 (이중 결제 방지)");
  // 확정(실패) 후에는 다시 결제 시작 가능 — 앱 재확인이 NOT_PROCESSED 등으로 실패 반영하는 경로와 같은 함수
  const rec = await svc("POST", "rpc/billing_record_result", { p_payment_id: list[0].payment_id, p_success: false, p_toss_payment_key: null, p_approved_at: null, p_failure_code: "NOT_PROCESSED", p_failure_message: "테스트" });
  assert.equal(rec.json.status, "failed");
  assert.equal((await sub(O)).status, "expired", "직접 결제 실패는 상태를 바꾸지 않음");
  const again = await svc("POST", "rpc/billing_start_manual", { p_business: O.biz, p_cycle: "monthly", p_consent_version: CONSENT });
  assert.ok(again.ok && again.json[0].amount === 10000, "확정 후 다시 결제 시작 가능 (영구 잠김 없음)");
});

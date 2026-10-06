// S-3 해지 ↔ pending 자동결제(017) DB 통합 테스트 — "테스트 Supabase 프로젝트"에서만 실행.
// 재처리 로직은 운영 cron 과 같은 runAutoPending(src/lib/billing/auto-pending.ts), DB 는 실제 테스트 프로젝트,
// 토스는 가짜(멱등키·응답 유실·주문번호 조회 흉내). 실제 토스 API 는 호출하지 않는다.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTarget, mintUserToken } from "../../scripts/lib/env.mjs";
import { runAutoPending } from "../../src/lib/billing/auto-pending.ts";

const t = loadTarget("test");
const CONSENT = "test-consent-v1";
const run = crypto.randomBytes(4).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const SH = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };
const created = [];
const hashOf = (n) => crypto.createHash("sha256").update(`${run}:s3:${n}`).digest("hex");

const call = async (u, method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { apikey: t.anonKey, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: r.status, ok: r.ok, json, code: json?.code, message: json?.message ?? "" };
};
const SERVER = { token: t.serviceKey };
const svc = async (method, pq, body) => {
  const r = await call(SERVER, method, pq, body);
  assert.ok(r.ok, `svc ${method} ${pq}: ${r.status} ${r.message}`);
  return r.json;
};
const rpc = async (name, args) => {
  const r = await call(SERVER, "POST", `rpc/${name}`, args);
  return { error: r.ok ? null : { code: r.code, message: r.message } };
};

after(async () => {
  for (const id of created) {
    const p = (await svc("GET", `profiles?id=eq.${id}&select=business_id,role`))[0];
    if (p?.business_id && p.role === "owner") await call(SERVER, "DELETE", `businesses?id=eq.${p.business_id}`);
    await fetch(`${t.url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: SH });
  }
});

// ── 가짜 토스 (tests/local/billing-cancel-pending.test.mjs 와 같은 동작) ──
class FakeToss {
  constructor() { this.byIdem = new Map(); this.byOrder = new Map(); this.calls = []; this.next = "ok"; }
  charge(row) {
    const idem = `mn-sub-${row.payment_id}`;
    this.calls.push({ orderId: row.order_id, billingKey: row.billing_key_enc, idem });
    if (this.byIdem.has(idem)) return this.byIdem.get(idem);
    const mode = this.next; this.next = "ok";
    if (mode === "unreached") return { outcome: "unknown", code: "NETWORK_ERROR" };
    const payment = { status: "DONE", totalAmount: row.amount, paymentKey: `pk_${row.order_id}`, approvedAt: new Date().toISOString() };
    const result = { outcome: "paid", paymentKey: payment.paymentKey, approvedAt: payment.approvedAt };
    this.byIdem.set(idem, result);
    this.byOrder.set(row.order_id, payment);
    return mode === "lost" ? { outcome: "unknown", code: "NETWORK_ERROR" } : result;
  }
  lookup(orderId) { const p = this.byOrder.get(orderId); return p ? { found: true, ...p } : { found: false }; }
  chargesFor(orderId) { return this.calls.filter((c) => c.orderId === orderId); }
}

const depsFor = (toss) => ({
  lookup: async (orderId) => toss.lookup(orderId),
  chargeAndRecord: async (row) => {
    const r = toss.charge(row);
    if (r.outcome === "unknown") return r;
    await rpc("billing_record_result", {
      p_payment_id: row.payment_id, p_success: r.outcome === "paid", p_toss_payment_key: r.paymentKey ?? null,
      p_approved_at: r.approvedAt ?? null, p_failure_code: r.code ?? null, p_failure_message: r.message ?? null,
    });
    return r;
  },
  rpc,
});

/** 운영 cron 과 같은 순서. 테스트 DB 의 다른 사업장 결제는 건드리지 않도록 이 실행에서 만든 매장 행만 처리한다. */
async function runCron(toss, owners) {
  await rpc("expire_ended_cancellations", {});
  const rows = (await svc("POST", "rpc/billing_claim_due", { p_limit: 500 })) ?? [];
  const mine = rows.filter((r) => owners.some((o) => o.biz === r.business_id));
  const out = [];
  for (const row of mine) out.push(await runAutoPending(row, depsFor(toss)));
  return out;
}

let seq = 0;
async function mkOwner(label) {
  const n = ++seq;
  const email = `s3-${run}-${label}@gmail.com`;
  const r = await fetch(`${t.url}/auth/v1/admin/users`, { method: "POST", headers: SH, body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: { full_name: `S3-${label}` } }) });
  const j = await r.json();
  assert.ok(r.ok, `create ${label}`);
  created.push(j.id);
  const u = { id: j.id, email, token: await mintUserToken(t, { id: j.id, email }), n };
  const b = await call(SERVER, "POST", "rpc/create_my_business_as", { p_user: u.id, p_name: `S3-${run}-${label}`, p_representative_name: "대표", p_business_number_hash: hashOf(n), p_business_number_masked: "123-**-***45" });
  assert.ok(b.ok, `biz ${label}: ${b.status} ${b.message}`);
  u.biz = b.json;
  await attach(u, `enc-old-${run}-${n}`);
  await setSub(u, { status: "active", billing_cycle: "monthly", current_period_start: iso(Date.now() - 30 * 86_400_000), current_period_end: iso(laterToday()) });
  return u;
}
async function attach(u, enc) {
  const key = (await call(u, "POST", "rpc/billing_customer_key", {})).json;
  await svc("POST", "rpc/billing_attach_method", { p_business: u.biz, p_customer_key: key, p_billing_key_enc: enc, p_card_company: "국민", p_card_number_masked: "5585****0000", p_card_type: "신용", p_billing_cycle: "monthly", p_consent_version: CONSENT });
}
const sub = async (u) => (await svc("GET", `subscriptions?business_id=eq.${u.biz}&select=*`))[0];
const setSub = (u, patch) => svc("PATCH", `subscriptions?business_id=eq.${u.biz}`, patch);
const pays = (u) => svc("GET", `subscription_payments?business_id=eq.${u.biz}&select=*&order=requested_at`);
const cancel = (u) => call(u, "POST", "rpc/billing_cancel_auto_renewal", {});
const writable = async (u) => (await call(SERVER, "POST", "rpc/business_is_writable", { p_business: u.biz })).json;
/** 이전 실행의 pending 을 "충분히 오래된" 것으로 (다음 날 cron 상황) */
const agePending = (u) => svc("PATCH", `subscription_payments?business_id=eq.${u.biz}&status=eq.pending`, { requested_at: iso(Date.now() - 86_400_000) });
const iso = (d) => new Date(d).toISOString();
const ms = (a) => new Date(a).getTime();
const monthAfter = (due) => { const d = new Date(due); d.setUTCMonth(d.getUTCMonth() + 1); return d.getTime(); };
// 결제일 당일(한국 날짜) 안의 조금 뒤 (자정 직전이면 자정 1분 전까지)
const laterToday = () => {
  const now = Date.now(); const kst = new Date(now + 9 * 3600_000);
  const mid = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - 9 * 3600_000;
  return new Date(now + Math.max(30_000, Math.min(10 * 60_000, mid - now - 60_000)));
};

test("① 결제일 전 해지 / ② 결제일 당일 해지 → 기간 유지, 자동결제 없음", async () => {
  const toss = new FakeToss();
  const A = await mkOwner("before");
  await setSub(A, { current_period_end: iso(Date.now() + 10 * 86_400_000) });
  const B = await mkOwner("dueday");
  for (const u of [A, B]) {
    const before = await sub(u);
    const r = await cancel(u);
    assert.ok(r.ok, `${r.status} ${r.message}`);
    const s = await sub(u);
    assert.equal(s.status, "canceled");
    assert.equal(ms(s.current_period_end), ms(before.current_period_end), "기간은 줄지 않음");
    assert.equal(await writable(u), true, "해지해도 현재 기간은 이용");
  }
  await setSub(A, { current_period_end: iso(laterToday()) }); // A 도 결제일 당일이 됨
  await runCron(toss, [A, B]);
  assert.equal(toss.calls.length, 0, "결제 요청 없음");
  assert.equal((await pays(A)).length + (await pays(B)).length, 0);
});

test("③ pending → 해지 → 토스 기록 없음 → 재결제 없이 NOT_PROCESSED 종료, canceled 유지", async () => {
  const toss = new FakeToss();
  const u = await mkOwner("noreq");
  toss.next = "unreached";
  await runCron(toss, [u]);
  const [p] = await pays(u);
  assert.equal(p.status, "pending");
  assert.ok((await cancel(u)).ok, "결제 확인 중에도 해지 접수");
  await agePending(u);
  const out = await runCron(toss, [u]);
  assert.deepEqual(out, ["closed"]);
  assert.equal(toss.chargesFor(p.order_id).length, 1, "처음 1번 외 재요청 없음");
  const [closed] = await pays(u);
  assert.equal(closed.status, "failed");
  assert.equal(closed.failure_code, "NOT_PROCESSED");
  assert.equal(closed.review_required, false);
  assert.equal((await sub(u)).status, "canceled");
});

test("④⑧ pending → 해지 → 토스에 결제 완료(응답 유실) → 결제 기간만 반영 + canceled 유지(active 아님), 이후 결제 없음", async () => {
  const toss = new FakeToss();
  const u = await mkOwner("paidcancel");
  toss.next = "lost";
  await runCron(toss, [u]);
  const [p] = await pays(u);
  assert.ok((await cancel(u)).ok);
  // "해지 전에 승인된 결제": 승인 시각을 DB 시계(canceled_at) 기준으로 명확히 해지 60초 전으로 둔다
  // (로컬 JS 시계로 만든 시각은 DB now() 와 0.1초 안팎 차이로 순서가 뒤집힐 수 있다)
  const { canceled_at } = await sub(u);
  toss.byOrder.get(p.order_id).approvedAt = iso(ms(canceled_at) - 60_000);
  await setSub(u, { current_period_end: iso(Date.now() - 60_000) }); // 해지 기간도 끝나 expired(cancelled) 가 되는 경우까지
  await agePending(u);
  await runCron(toss, [u]);
  const [paid] = await pays(u);
  assert.equal(paid.status, "paid");
  assert.equal(paid.review_required, false, "해지 전에 승인된 정상 결제");
  const s = await sub(u);
  assert.equal(s.status, "canceled", "active 로 되돌아가지 않음");
  assert.equal(ms(s.current_period_end), monthAfter(p.due_at), "결제된 1개월만 반영");
  assert.equal(toss.chargesFor(p.order_id).length, 1, "조회로 확인, 재요청 없음");
  await setSub(u, { current_period_end: iso(laterToday()) }); // 다음 결제일
  await runCron(toss, [u]);
  assert.equal(toss.calls.length, 1, "다음 자동결제 없음");
});

test("⑤ pending → 해지 → 토스 결제 실패 → canceled 유지", async () => {
  const toss = new FakeToss();
  const u = await mkOwner("failcancel");
  toss.next = "unreached";
  await runCron(toss, [u]);
  const [p] = await pays(u);
  toss.byOrder.set(p.order_id, { status: "ABORTED", totalAmount: p.amount, paymentKey: null, approvedAt: null });
  assert.ok((await cancel(u)).ok);
  await agePending(u);
  assert.deepEqual(await runCron(toss, [u]), ["failed"]);
  const [failed] = await pays(u);
  assert.equal(failed.failure_code, "ABORTED");
  assert.equal((await sub(u)).status, "canceled", "expired(payment_failed) 로 바뀌지 않음");
  assert.equal(await writable(u), true);
});

test("⑥ pending → 카드 변경 → 이전 빌링키로 재결제 없음(NOT_PROCESSED), 상태 유지 → 다음 실행에서 새 카드로 결제", async () => {
  const toss = new FakeToss();
  const u = await mkOwner("cardchange");
  toss.next = "unreached";
  await runCron(toss, [u]);
  const [p] = await pays(u);
  await attach(u, `enc-new-${run}-${u.n}`);
  await agePending(u);
  assert.deepEqual(await runCron(toss, [u]), ["closed"]);
  assert.deepEqual(toss.calls.map((c) => c.billingKey), [`enc-old-${run}-${u.n}`]);
  assert.equal((await sub(u)).status, "active", "차단·만료 없음");
  await runCron(toss, [u]);
  assert.deepEqual(toss.calls.map((c) => c.billingKey), [`enc-old-${run}-${u.n}`, `enc-new-${run}-${u.n}`], "같은 결제일에 새 카드로 1건");
  const s = await sub(u);
  assert.equal(s.status, "active");
  assert.equal(ms(s.current_period_end), monthAfter(p.due_at));
});

test("⑦ 응답 유실 후 실제로는 결제 성공 → 다음 cron 에서 주문 조회로 성공 확정", async () => {
  const toss = new FakeToss();
  const u = await mkOwner("lost");
  toss.next = "lost";
  assert.deepEqual(await runCron(toss, [u]), ["unknown"]);
  const [p] = await pays(u);
  await agePending(u);
  assert.deepEqual(await runCron(toss, [u]), ["paid"]);
  assert.equal(toss.chargesFor(p.order_id).length, 1);
  const s = await sub(u);
  assert.equal(s.status, "active");
  assert.equal(ms(s.current_period_end), monthAfter(p.due_at));
});

test("⑨ 해지 후 승인 시각이 해지보다 늦음 → 자동 환불 없이 review_required + 감사 로그", async () => {
  const toss = new FakeToss();
  const u = await mkOwner("review");
  toss.next = "unreached";
  await runCron(toss, [u]);
  const [p] = await pays(u);
  assert.ok((await cancel(u)).ok);
  toss.byOrder.set(p.order_id, { status: "DONE", totalAmount: p.amount, paymentKey: "pk_late", approvedAt: new Date(Date.now() + 60_000).toISOString() });
  await agePending(u);
  await runCron(toss, [u]);
  const [paid] = await pays(u);
  assert.equal(paid.status, "paid");
  assert.equal(paid.review_required, true);
  assert.equal(paid.review_reason, "approved_after_cancel");
  assert.equal((await sub(u)).status, "canceled");
  const logs = await svc("GET", `audit_logs?action=eq.billing.review_required&resource_id=eq.${p.id}&select=id`);
  assert.equal(logs.length, 1);
});

test("⑩ 같은 pending 을 cron 두 개가 동시에 처리 → 토스 결제 1건, 기간 1회 연장, 재실행해도 추가 요청 없음", async () => {
  const toss = new FakeToss();
  const u = await mkOwner("concurrent");
  toss.next = "unreached";
  await runCron(toss, [u]);
  const [p] = await pays(u);
  await agePending(u);
  const rows = ((await svc("POST", "rpc/billing_claim_due", { p_limit: 500 })) ?? []).filter((r) => r.payment_id === p.id);
  assert.equal(rows.length, 1);
  await Promise.all([runAutoPending(rows[0], depsFor(toss)), runAutoPending(rows[0], depsFor(toss))]);
  assert.equal(toss.byOrder.size, 1, "토스 결제 1건 (같은 멱등키)");
  assert.equal(new Set(toss.chargesFor(p.order_id).map((c) => c.idem)).size, 1);
  const s = await sub(u);
  assert.equal(ms(s.current_period_end), monthAfter(p.due_at), "기간 1회만 연장");
  const requests = toss.chargesFor(p.order_id).length;
  await runCron(toss, [u]);
  await runCron(toss, [u]);
  assert.equal(toss.chargesFor(p.order_id).length, requests, "확정 후 재실행해도 추가 요청 없음");
  assert.equal((await pays(u)).filter((x) => x.status === "paid").length, 1);
});

test("권한: billing_close_pending 은 브라우저 권한으로 호출 불가", async () => {
  const u = await mkOwner("perm");
  const r = await call(u, "POST", "rpc/billing_close_pending", { p_payment_id: crypto.randomUUID(), p_code: "NOT_PROCESSED", p_review: false });
  assert.ok(!r.ok);
  assert.equal(r.code, "42501");
});

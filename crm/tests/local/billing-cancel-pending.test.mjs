// S-3: 자동결제 해지 ↔ pending 자동결제 시나리오 (로컬 전용)
//   - DB: 메모리 안의 PGlite 에 schema + 마이그레이션 001~017 을 그대로 적용 (어떤 Supabase 프로젝트에도 연결하지 않음)
//   - 재처리 로직: 운영 코드와 같은 runAutoPending (src/lib/billing/auto-pending.ts)
//   - 토스: 가짜 서버 (멱등키, 응답 유실, 주문번호 조회). 실제 토스 API 는 호출하지 않는다.
//   node --test tests/local/
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { decideAutoPending, runAutoPending, PENDING_NOT_FOUND_GRACE_SECONDS } from "../../src/lib/billing/auto-pending.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, "supabase", p), "utf8");

const db = new PGlite();
await db.exec(read("tests/_supabase_stub.sql"));
await db.exec(read("schema.sql").replace(/create extension[^;]*;/gi, ""));
for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
  await db.exec(read(`migrations/${f}`));
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
// "오늘(한국 날짜) 안의 조금 뒤" = 결제일 당일, 아직 이용기간 안
const LATER_TODAY = `least(now() + interval '10 minutes',
  (date_trunc('day', now() at time zone 'Asia/Seoul') + interval '1 day' - interval '1 second') at time zone 'Asia/Seoul')`;

// ── 가짜 토스: 멱등키당 결제 1건, 주문번호 조회 ──
class FakeToss {
  constructor() { this.byIdem = new Map(); this.byOrder = new Map(); this.calls = []; this.next = "ok"; }
  charge(row) {
    const billingKey = row.billing_key_enc; // 테스트에서는 암호문 자리에 식별용 문자열을 둔다
    const idem = `mn-sub-${row.payment_id}`;
    this.calls.push({ orderId: row.order_id, billingKey, idem });
    if (this.byIdem.has(idem)) return this.byIdem.get(idem).result; // 같은 멱등키 → 첫 결과 그대로 (이중 결제 없음)
    const mode = this.next; this.next = "ok";
    if (mode === "unreached") return { outcome: "unknown", code: "NETWORK_ERROR" }; // 토스에 도달하지 못함 (기록 없음)
    const payment = { status: mode === "decline" ? "ABORTED" : "DONE", totalAmount: row.amount, paymentKey: `pk_${row.order_id}`, approvedAt: new Date().toISOString() };
    const result = mode === "decline" ? { outcome: "failed", code: "REJECT_CARD_COMPANY", message: "거절" }
      : { outcome: "paid", paymentKey: payment.paymentKey, approvedAt: payment.approvedAt };
    this.byIdem.set(idem, { result });
    this.byOrder.set(row.order_id, payment);
    // lost: 토스에서는 결제됐지만 응답이 유실됨 → 우리 쪽은 결과를 모른다
    return mode === "lost" ? { outcome: "unknown", code: "NETWORK_ERROR" } : result;
  }
  lookup(orderId) {
    const p = this.byOrder.get(orderId);
    return p ? { found: true, ...p } : { found: false };
  }
  chargesFor(orderId) { return this.calls.filter((c) => c.orderId === orderId); }
  paymentsCreated(orderId) { return this.byOrder.has(orderId) ? 1 : 0; }
}

async function rpc(name, args) {
  const keys = Object.keys(args);
  try {
    await db.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, keys.map((k) => args[k]));
    return { error: null };
  } catch (e) {
    return { error: { code: e.code, message: e.message } };
  }
}

/** 운영 cron 과 같은 순서: 해지 만료 정리 → billing_claim_due → 행마다 runAutoPending (processCharge 는 가짜 토스 + 같은 기록 함수) */
async function runCron(toss) {
  await db.query("select public.expire_ended_cancellations()");
  const { rows } = await db.query("select * from public.billing_claim_due(50)");
  const deps = {
    lookup: async (orderId) => toss.lookup(orderId),
    chargeAndRecord: async (row) => {
      const r = toss.charge(row);
      if (r.outcome === "unknown") return r;
      await rpc("billing_record_result", {
        p_payment_id: row.payment_id, p_success: r.outcome === "paid",
        p_toss_payment_key: r.outcome === "paid" ? r.paymentKey : null, p_approved_at: r.outcome === "paid" ? r.approvedAt : null,
        p_failure_code: r.outcome === "failed" ? r.code : null, p_failure_message: r.outcome === "failed" ? r.message : null,
      });
      return r;
    },
    rpc,
  };
  const outcomes = [];
  for (const row of rows) outcomes.push({ row, outcome: await runAutoPending(row, deps) });
  return outcomes;
}

let seq = 0;
/** 대표 계정 + 사업장 + 카드(자동결제 동의) 준비. status: active(이용기간 끝 = periodEndSql) 또는 trial(체험 끝 = periodEndSql) */
async function setup({ status = "active", periodEndSql = LATER_TODAY } = {}) {
  const n = ++seq;
  const uid = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [uid, `s3-${n}@test.local`]);
  const biz = (await one(`select public.create_my_business_as($1::uuid, $2, null, null, '대표', $3) as id`,
    [uid, `S3매장${n}`, crypto.randomBytes(32).toString("hex")])).id;
  await db.query("update subscriptions set external_customer_id = $2 where business_id = $1", [biz, `mn_cust_${n}`]);
  await rpc("billing_attach_method", {
    p_business: biz, p_customer_key: `mn_cust_${n}`, p_billing_key_enc: `enc-old-${n}`, p_card_company: "테스트카드",
    p_card_number_masked: "1234-****", p_card_type: "신용", p_billing_cycle: "monthly", p_consent_version: "draft-2026-09-30",
  });
  if (status === "active") {
    await db.query(`update subscriptions set status = 'active', current_period_start = now() - interval '1 month', current_period_end = ${periodEndSql} where business_id = $1`, [biz]);
  } else {
    await db.query(`update subscriptions set trial_ends_at = ${periodEndSql} where business_id = $1`, [biz]);
  }
  return { n, uid, biz };
}

async function cancelAsOwner(uid) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await tx.query("set local role authenticated");
    return (await tx.query("select public.billing_cancel_auto_renewal() as r")).rows[0].r;
  });
}

const sub = (biz) => one("select * from subscriptions where business_id = $1", [biz]);
const pays = async (biz) => (await db.query("select * from subscription_payments where business_id = $1 order by requested_at", [biz])).rows;
const writable = async (biz) => (await one("select public.business_is_writable($1) as w", [biz])).w;
/** 이전 실행의 pending 을 "충분히 오래된" 것으로 만든다 (다음 날 cron 상황) */
const agePending = (biz) => db.query("update subscription_payments set requested_at = now() - interval '1 day' where business_id = $1 and status = 'pending'", [biz]);
const ms = (v) => new Date(v).getTime();
const MONTH_AFTER = (due) => { const d = new Date(due); d.setMonth(d.getMonth() + 1); return d.getTime(); };

test("① 결제일 전 해지 → 이용기간 유지, 결제일·다음 달에도 자동결제 없음", async () => {
  const toss = new FakeToss();
  const { uid, biz } = await setup({ periodEndSql: "now() + interval '10 days'" });
  const before = await sub(biz);
  const r = await cancelAsOwner(uid);
  assert.equal(r.status, "canceled");
  const after = await sub(biz);
  assert.equal(after.status, "canceled");
  assert.equal(ms(after.current_period_end), ms(before.current_period_end), "이용기간은 줄지 않는다");
  assert.equal(await writable(biz), true, "해지해도 현재 기간은 계속 이용");
  await db.query(`update subscriptions set current_period_end = ${LATER_TODAY} where business_id = $1`, [biz]); // 결제일 당일이 됨
  await runCron(toss);
  await db.query("update subscriptions set current_period_end = now() - interval '1 minute' where business_id = $1", [biz]); // 기간 종료
  await runCron(toss);
  assert.equal(toss.calls.length, 0, "토스 결제 요청 없음");
  assert.equal((await pays(biz)).length, 0, "결제 기록 없음");
  const ended = await sub(biz);
  assert.equal(ended.status, "expired");
  assert.equal(ended.expired_reason, "cancelled");
});

test("② 결제일 당일 해지 → 현재 기간 유지 + 자동결제 없음 (체험 종료일 당일 해지 포함)", async () => {
  for (const status of ["active", "trial"]) {
    const toss = new FakeToss();
    const { uid, biz } = await setup({ status });
    await cancelAsOwner(uid);
    const s = await sub(biz);
    assert.equal(s.status, "canceled", status);
    assert.ok(ms(s.current_period_end) > Date.now(), `${status}: 오늘 끝나는 기간을 그대로 유지`);
    assert.equal(await writable(biz), true, `${status}: 기간 안에는 계속 이용`);
    await runCron(toss);
    assert.equal(toss.calls.length, 0, `${status}: 결제 요청 없음`);
    await db.query("update subscriptions set current_period_end = now() - interval '1 minute' where business_id = $1", [biz]);
    await runCron(toss);
    assert.equal(toss.calls.length, 0, `${status}: 다음 실행에도 결제 없음`);
    assert.equal((await sub(biz)).status, "expired", `${status}: 기간 종료 후 expired(cancelled)`);
  }
});

test("③ pending → 해지 → 토스 기록 없음 → 재결제하지 않고 pending 종료, 해지 유지", async () => {
  const toss = new FakeToss();
  const { uid, biz } = await setup();
  toss.next = "unreached";
  await runCron(toss);
  const [p] = await pays(biz);
  assert.equal(p.status, "pending");
  assert.equal((await cancelAsOwner(uid)).status, "canceled", "결제 확인 중에도 해지는 접수");
  await agePending(biz);
  const out = await runCron(toss);
  assert.equal(out.find((o) => o.row.payment_id === p.id).outcome, "closed");
  assert.equal(toss.chargesFor(p.order_id).length, 1, "처음 1번 외에 다시 결제 요청하지 않음");
  const [closed] = await pays(biz);
  assert.equal(closed.status, "failed");
  assert.equal(closed.failure_code, "NOT_PROCESSED");
  assert.equal((await sub(biz)).status, "canceled", "구독 상태는 바뀌지 않음");
  await runCron(toss);
  assert.equal(toss.calls.length, 1, "이후 실행에도 결제 없음");
});

test("④ pending → 해지 → 토스에 이미 결제 완료 → 결제 기간만 반영 + canceled 유지 + 다음 달 결제 없음", async () => {
  const toss = new FakeToss();
  const { uid, biz } = await setup();
  toss.next = "lost";
  await runCron(toss);
  const [p] = await pays(biz);
  await cancelAsOwner(uid);
  await agePending(biz);
  await runCron(toss);
  const [paid] = await pays(biz);
  assert.equal(paid.status, "paid");
  assert.equal(paid.review_required, false, "해지 전에 승인된 정상 결제");
  const s = await sub(biz);
  assert.equal(s.status, "canceled");
  assert.equal(ms(s.current_period_end), MONTH_AFTER(p.due_at), "결제된 1개월만 반영");
  assert.equal(toss.chargesFor(p.order_id).length, 1, "다시 결제하지 않음 (조회로 확인)");
  await db.query(`update subscriptions set current_period_end = ${LATER_TODAY} where business_id = $1`, [biz]); // 다음 결제일
  await runCron(toss);
  assert.equal(toss.calls.length, 1, "다음 달 자동결제 없음");
  assert.equal((await pays(biz)).length, 1);
});

test("⑤ pending → 해지 → 토스 결제 실패 → canceled 유지", async () => {
  const toss = new FakeToss();
  const { uid, biz } = await setup();
  toss.next = "unreached";
  await runCron(toss);
  const [p] = await pays(biz);
  toss.byOrder.set(p.order_id, { status: "ABORTED", totalAmount: p.amount, paymentKey: null, approvedAt: null });
  await cancelAsOwner(uid);
  await agePending(biz);
  const out = await runCron(toss);
  assert.equal(out[0].outcome, "failed");
  const [failed] = await pays(biz);
  assert.equal(failed.status, "failed");
  assert.equal(failed.failure_code, "ABORTED");
  const s = await sub(biz);
  assert.equal(s.status, "canceled", "expired(payment_failed) 로 바뀌지 않음");
  assert.equal(await writable(biz), true, "해지 기간은 그대로 이용");
});

test("⑥ pending → 카드 변경 → 이전 카드(빌링키)로 재결제하지 않음, 구독 상태 유지, 다음 실행에서 새 카드로 결제", async () => {
  const toss = new FakeToss();
  const { n, biz } = await setup();
  toss.next = "unreached";
  await runCron(toss);
  const [p] = await pays(biz);
  await rpc("billing_attach_method", {
    p_business: biz, p_customer_key: `mn_cust_${n}`, p_billing_key_enc: `enc-new-${n}`, p_card_company: "새카드",
    p_card_number_masked: "5678-****", p_card_type: "신용", p_billing_cycle: "monthly", p_consent_version: "draft-2026-09-30",
  });
  await agePending(biz);
  await runCron(toss);
  assert.deepEqual(toss.calls.map((c) => c.billingKey), [`enc-old-${n}`], "이전 빌링키로 다시 요청하지 않음");
  const [closed] = await pays(biz);
  assert.equal(closed.status, "failed");
  assert.equal(closed.failure_code, "NOT_PROCESSED");
  assert.equal((await sub(biz)).status, "active", "구독 상태는 바뀌지 않음 (차단·만료 없음)");
  await runCron(toss); // 다음 실행: 같은 결제일에 새 카드로 1건
  assert.deepEqual(toss.calls.map((c) => c.billingKey), [`enc-old-${n}`, `enc-new-${n}`]);
  const s = await sub(biz);
  assert.equal(s.status, "active");
  assert.equal(ms(s.current_period_end), MONTH_AFTER(p.due_at));
});

test("⑦ 토스 응답 유실 후 실제로는 결제 성공 → 다음 cron 에서 주문 조회로 성공 확인 (재결제 없음)", async () => {
  const toss = new FakeToss();
  const { biz } = await setup();
  toss.next = "lost";
  const first = await runCron(toss);
  assert.equal(first[0].outcome, "unknown");
  const [p] = await pays(biz);
  assert.equal(p.status, "pending");
  await agePending(biz);
  const second = await runCron(toss);
  assert.equal(second[0].outcome, "paid");
  assert.equal(toss.chargesFor(p.order_id).length, 1, "결제 요청은 처음 1번뿐");
  const s = await sub(biz);
  assert.equal(s.status, "active");
  assert.equal(ms(s.current_period_end), MONTH_AFTER(p.due_at));
});

test("⑧ 해지 후 기간이 끝나 expired(cancelled) 가 된 뒤 결제 성공이 확인돼도 active 로 돌아가지 않음", async () => {
  const toss = new FakeToss();
  const { uid, biz } = await setup();
  toss.next = "lost";
  await runCron(toss);
  const [p] = await pays(biz);
  await cancelAsOwner(uid);
  await db.query("update subscriptions set current_period_end = now() - interval '1 minute' where business_id = $1", [biz]);
  await agePending(biz);
  await runCron(toss); // 같은 실행에서 먼저 expired(cancelled) → 이어서 pending 을 조회로 확정
  const s = await sub(biz);
  assert.notEqual(s.status, "active");
  assert.equal(s.status, "canceled", "결제된 기간 동안 해지 상태로 이용");
  assert.equal(ms(s.current_period_end), MONTH_AFTER(p.due_at));
  assert.equal((await one("select count(*)::int as c from subscription_payments where business_id = $1 and status = 'pending'", [biz])).c, 0);
  await db.query(`update subscriptions set current_period_end = ${LATER_TODAY} where business_id = $1`, [biz]);
  await runCron(toss);
  assert.equal(toss.calls.length, 1, "다음 결제 예약 없음");
});

test("⑨ 해지 후 결제 승인 시각이 해지보다 늦음 → 자동 환불 없이 관리자 확인 대상으로 기록", async () => {
  const toss = new FakeToss();
  const { uid, biz } = await setup();
  toss.next = "unreached";
  await runCron(toss);
  const [p] = await pays(biz);
  await cancelAsOwner(uid);
  // 정상 흐름과 다른 경우: 토스에는 해지 "이후" 시각에 승인된 기록이 있음
  toss.byOrder.set(p.order_id, { status: "DONE", totalAmount: p.amount, paymentKey: "pk_late", approvedAt: new Date(Date.now() + 60_000).toISOString() });
  await agePending(biz);
  await runCron(toss);
  const [paid] = await pays(biz);
  assert.equal(paid.status, "paid");
  assert.equal(paid.review_required, true);
  assert.equal(paid.review_reason, "approved_after_cancel");
  assert.equal((await sub(biz)).status, "canceled");
  const log = await one("select count(*)::int as c from audit_logs where action = 'billing.review_required' and resource_id = $1", [p.id]);
  assert.equal(log.c, 1, "감사 로그에 관리자 확인 기록");
});

test("⑩ 같은 pending 을 cron 이 거듭(동시) 처리해도 중복 결제되지 않음", async () => {
  const toss = new FakeToss();
  const { biz } = await setup();
  toss.next = "unreached";
  await runCron(toss);
  const [p] = await pays(biz);
  await agePending(biz);
  // 두 cron 실행이 같은 pending 을 동시에 잡은 상황
  const { rows } = await db.query("select * from public.billing_claim_due(50) where payment_id = $1", [p.id]);
  const deps = {
    lookup: async (o) => toss.lookup(o),
    chargeAndRecord: async (row) => {
      const r = toss.charge(row);
      if (r.outcome !== "unknown") {
        await rpc("billing_record_result", { p_payment_id: row.payment_id, p_success: r.outcome === "paid", p_toss_payment_key: r.paymentKey ?? null,
          p_approved_at: r.approvedAt ?? null, p_failure_code: null, p_failure_message: null });
      }
      return r;
    },
    rpc,
  };
  await Promise.all([runAutoPending(rows[0], deps), runAutoPending(rows[0], deps)]);
  assert.equal(toss.paymentsCreated(p.order_id), 1, "토스 결제는 1건 (같은 멱등키)");
  assert.equal(new Set(toss.chargesFor(p.order_id).map((c) => c.idem)).size, 1, "멱등키 정책 유지: mn-sub-<결제 id>");
  const s = await sub(biz);
  assert.equal(ms(s.current_period_end), MONTH_AFTER(p.due_at), "이용기간은 한 번만 연장");
  const requestsSoFar = toss.chargesFor(p.order_id).length; // 처음(미도달) 1번 + 동시 실행 2번 — 모두 같은 멱등키
  await runCron(toss);
  await runCron(toss);
  assert.equal(toss.chargesFor(p.order_id).length, requestsSoFar, "확정된 뒤 재실행해도 추가 요청 없음");
  assert.equal((await pays(biz)).filter((x) => x.status === "paid").length, 1);
});

test("기존 정책 유지: 해지되지 않은 구독의 자동결제 실패 → 즉시 expired(payment_failed), 연장 없음", async () => {
  const toss = new FakeToss();
  const { biz } = await setup();
  const before = await sub(biz);
  toss.next = "decline";
  await runCron(toss);
  const s = await sub(biz);
  assert.equal(s.status, "expired");
  assert.equal(s.expired_reason, "payment_failed");
  assert.equal(ms(s.current_period_end), ms(before.current_period_end), "기간 연장 없음");
});

test("기존 정책 유지: 해지 후 기간이 끝난 매장의 직접 결제는 다시 active (재구독)", async () => {
  const { uid, biz } = await setup();
  await cancelAsOwner(uid);
  await db.query("update subscriptions set current_period_end = now() - interval '1 minute' where business_id = $1", [biz]);
  await db.query("select public.expire_ended_cancellations()");
  const [m] = (await db.query("select * from public.billing_start_manual($1, 'monthly', 'draft-2026-09-30')", [biz])).rows;
  await rpc("billing_record_result", { p_payment_id: m.payment_id, p_success: true, p_toss_payment_key: "pk_manual", p_approved_at: new Date().toISOString(), p_failure_code: null, p_failure_message: null });
  assert.equal((await sub(biz)).status, "active");
});

test("권한: billing_close_pending 은 서버 전용, 직접결제(manual) 는 대상이 아님", async () => {
  const { uid, biz } = await setup();
  const grants = await one(`select has_function_privilege('authenticated', 'public.billing_close_pending(uuid,text,boolean)', 'execute') as a,
                                   has_function_privilege('service_role', 'public.billing_close_pending(uuid,text,boolean)', 'execute') as s`);
  assert.deepEqual(grants, { a: false, s: true });
  await cancelAsOwner(uid);
  await db.query("update subscriptions set current_period_end = now() - interval '1 minute' where business_id = $1", [biz]);
  await db.query("select public.expire_ended_cancellations()");
  const [m] = (await db.query("select * from public.billing_start_manual($1, 'monthly', 'draft-2026-09-30')", [biz])).rows;
  const r = await rpc("billing_close_pending", { p_payment_id: m.payment_id, p_code: "NOT_PROCESSED", p_review: false });
  assert.equal(r.error?.code, "22023");
});

test("판단 규칙: 조회 실패·유예 시간 이내·처리 중이면 기다리고, 금액이 다르면 관리자 확인으로 종료", () => {
  const row = { payment_id: "x", order_id: "o", amount: 10000, is_new: false, retry_allowed: true, requested_at: new Date().toISOString() };
  const now = Date.now();
  assert.equal(decideAutoPending(row, { error: "NETWORK_ERROR" }, now).type, "wait");
  assert.equal(decideAutoPending(row, { found: false }, now).type, "wait");
  assert.equal(decideAutoPending(row, { found: false }, now + PENDING_NOT_FOUND_GRACE_SECONDS * 1000).type, "charge");
  assert.equal(decideAutoPending({ ...row, retry_allowed: false }, { found: false }, now + PENDING_NOT_FOUND_GRACE_SECONDS * 1000).type, "close");
  assert.equal(decideAutoPending(row, { found: true, status: "IN_PROGRESS", totalAmount: 10000, paymentKey: null, approvedAt: null }, now).type, "wait");
  assert.deepEqual(decideAutoPending(row, { found: true, status: "DONE", totalAmount: 9000, paymentKey: "pk", approvedAt: null }, now),
    { type: "close", code: "UNEXPECTED_PAYMENT_RESULT", review: true });
  assert.equal(decideAutoPending({ ...row, is_new: true }, null, now).type, "charge");
});

// 구독 직접 결제(토스 결제위젯, 020) — 로컬 전용. PGlite 에 schema + 전체 마이그레이션. 토스는 호출하지 않는다.
//   node --test tests/local/
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, "supabase", p), "utf8");
const CONSENT = "draft-2026-09-30";

const db = new PGlite();
await db.exec(read("tests/_supabase_stub.sql"));
await db.exec(read("schema.sql").replace(/create extension[^;]*;/gi, ""));
for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
  await db.exec(read(`migrations/${f}`));
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const asUser = (uid, sql, params = []) =>
  db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await tx.query("set local role authenticated");
    return (await tx.query(sql, params)).rows;
  });
const start = async (uid, cycle = "monthly") => (await asUser(uid, "select * from public.billing_start_widget($1)", [cycle]))[0];
const record = (pid, ok, at = null) =>
  one(`select public.billing_record_widget_result($1, $2, $3, $4, $5, $6) as r`,
    [pid, ok, ok ? `pk_${pid}` : null, at, ok ? null : "REJECT", ok ? null : "거절"]);
const sub = (biz) => one("select * from subscriptions where business_id = $1", [biz]);
const writable = async (biz) => (await one("select public.business_is_writable($1) as w", [biz])).w;
const DAY = 24 * 3600 * 1000;

let seq = 0;
async function owner({ card = false, status = "trial", trialDays = 10 } = {}) {
  const n = ++seq;
  const uid = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [uid, `wd-${n}@test.local`]);
  const biz = (await one(`select public.create_my_business_as($1::uuid, $2, null, null, '대표', $3) as id`,
    [uid, `위젯매장${n}`, crypto.randomBytes(32).toString("hex")])).id;
  await db.query("update subscriptions set external_customer_id = $2 where business_id = $1", [biz, `mn_wd_${n}`]);
  // 기본: 체험 종료 10일 전 상황 (직접 결제는 남은 기간 31일 이내부터 가능)
  await db.query("update subscriptions set trial_ends_at = now() + make_interval(days => $2) where business_id = $1", [biz, trialDays]);
  if (card) {
    await db.query(`select public.billing_attach_method(p_business => $1, p_customer_key => $2, p_billing_key_enc => 'enc', p_card_company => '국민',
      p_card_number_masked => '5585****', p_card_type => '신용', p_billing_cycle => 'monthly', p_consent_version => $3)`, [biz, `mn_wd_${n}`, CONSENT]);
  }
  if (status === "expired") await db.query("update subscriptions set status = 'expired', expired_reason = 'trial_expired' where business_id = $1", [biz]);
  return { uid, biz };
}

test("만료된 매장: 직접 결제 성공 → 지금부터 1개월 이용, 자동결제 아님", async () => {
  const o = await owner({ status: "expired" });
  const p = await start(o.uid);
  assert.equal(p.amount, 10000);
  assert.match(p.order_id, /^mnsw_/);
  const r = (await record(p.payment_id, true)).r;
  assert.equal(r.status, "paid");
  const s = await sub(o.biz);
  assert.equal(s.status, "active");
  assert.equal(s.auto_renew_consented_at, null);
  const days = (s.current_period_end - s.current_period_start) / DAY;
  assert.ok(days >= 28 && days <= 31, `기간 ${days}일`);
  assert.equal(await writable(o.biz), true);
});

test("체험 중(결제수단 없음) 직접 결제 → 체험 종료 시각부터 이어서 연장, 지금도 계속 이용", async () => {
  const o = await owner();
  const t = await sub(o.biz);
  const p = await start(o.uid, "yearly");
  assert.equal(p.amount, 110000);
  await record(p.payment_id, true);
  const s = await sub(o.biz);
  assert.equal(s.status, "active");
  const ext = (s.current_period_end - t.trial_ends_at) / DAY;
  assert.ok(ext >= 364 && ext <= 366, `연장 ${ext}일`);
  assert.equal(await writable(o.biz), true);
});

test("직접 결제로 이용 중 → 기간 끝나기 전 다시 결제하면 남은 기간 끝에 이어서 연장", async () => {
  const o = await owner({ status: "expired" });
  await record((await start(o.uid)).payment_id, true);
  const s1 = await sub(o.biz);
  await record((await start(o.uid)).payment_id, true);
  const s2 = await sub(o.biz);
  const ext = (s2.current_period_end - s1.current_period_end) / DAY;
  assert.ok(ext >= 28 && ext <= 31, `연장 ${ext}일`);
  assert.equal(s2.current_period_start.getTime(), s1.current_period_start.getTime());
});

test("남은 기간이 31일을 넘으면 직접 결제를 받지 않는다 (too_early): 연간 결제 직후, 체험이 90일 남았을 때", async () => {
  const o = await owner({ status: "expired" });
  await record((await start(o.uid, "yearly")).payment_id, true);
  await assert.rejects(start(o.uid), /too_early/);
  const o2 = await owner({ trialDays: 90 });
  await assert.rejects(start(o2.uid), /too_early/);
});

test("자동결제가 켜진 구독(결제수단+동의)은 직접 결제 불가 (이중 결제 방지)", async () => {
  const o = await owner({ card: true });
  await assert.rejects(start(o.uid), /auto_renew_active/);
});

test("자동결제를 해지한 구독은 직접 결제 가능 → 해지 기간 끝에 이어서 연장, 자동결제 안 함", async () => {
  const o = await owner({ card: true });
  await asUser(o.uid, "select public.billing_cancel_auto_renewal()");
  assert.equal((await sub(o.biz)).status, "canceled");
  await record((await start(o.uid)).payment_id, true);
  const s = await sub(o.biz);
  assert.equal(s.status, "active");
  assert.equal(s.canceled_at, null);
  assert.equal(s.auto_renew_consented_at, null);
  // 기간 끝이 오늘이 되어도 스케줄러가 자동결제하지 않는다
  await db.query("update subscriptions set current_period_end = now() + interval '1 minute' where business_id = $1", [o.biz]);
  const due = (await db.query("select * from public.billing_claim_due(50)")).rows.filter((r) => r.business_id === o.biz);
  assert.equal(due.length, 0);
});

test("끝나지 않은 직접 결제는 새로 시작할 때 ABANDONED 로 닫히고, 닫힌 주문은 나중에 반영되지 않는다", async () => {
  const o = await owner({ status: "expired" });
  const p1 = await start(o.uid);
  const p2 = await start(o.uid);
  const old = await one("select status, failure_code from subscription_payments where id = $1", [p1.payment_id]);
  assert.deepEqual([old.status, old.failure_code], ["failed", "ABANDONED"]);
  assert.equal((await record(p1.payment_id, true)).r.already_recorded, true);
  assert.equal((await sub(o.biz)).status, "expired");
  await record(p2.payment_id, true);
  assert.equal((await sub(o.biz)).status, "active");
});

test("직접 결제 실패 → 구독 상태 변화 없음", async () => {
  const o = await owner({ status: "expired" });
  const p = await start(o.uid);
  assert.equal((await record(p.payment_id, false)).r.status, "failed");
  assert.equal((await sub(o.biz)).status, "expired");
});

test("직접 결제 기간이 끝나면 expired(period_ended), 결제수단이 있으면 자동결제 켜기로 이어갈 수 있다", async () => {
  const o = await owner({ card: true });
  await asUser(o.uid, "select public.billing_cancel_auto_renewal()");
  await record((await start(o.uid)).payment_id, true);
  // 자동결제 켜기: 지금 결제 없음, 기간 끝에 자동결제 대상
  const r = (await asUser(o.uid, "select public.billing_resume_auto_renewal($1) as r", [CONSENT]))[0].r;
  assert.equal(r.status, "active");
  assert.ok((await sub(o.biz)).auto_renew_consented_at);
  // 다른 매장: 기간 종료 → expired(period_ended)
  const o2 = await owner({ status: "expired" });
  await record((await start(o2.uid)).payment_id, true);
  await db.query("update subscriptions set current_period_end = now() - interval '1 minute' where business_id = $1", [o2.biz]);
  await one("select public.expire_ended_prepaid(null) as n");
  const s2 = await sub(o2.biz);
  assert.deepEqual([s2.status, s2.expired_reason], ["expired", "period_ended"]);
  assert.equal((await sub(o.biz)).status, "active", "자동결제 켠 구독은 건드리지 않음");
});

test("권한: 직원은 시작 불가, 결과 반영 함수는 브라우저 권한으로 실행 불가", async () => {
  const o = await owner({ status: "expired" });
  const staff = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [staff, `wd-staff-${staff.slice(0, 6)}@test.local`]);
  await db.query("update profiles set business_id = $2, role = 'staff' where id = $1", [staff, o.biz]);
  await assert.rejects(start(staff), /forbidden/);
  const p = await start(o.uid);
  await assert.rejects(asUser(o.uid, "select public.billing_record_widget_result($1, true, 'pk', null, null, null)", [p.payment_id]), /permission denied/);
});

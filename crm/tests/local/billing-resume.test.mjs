// 구독 연장 = 자동결제 해지 취소 (019) — 로컬 전용
//   - DB: 메모리 안의 PGlite 에 schema + 마이그레이션 전체 적용 (어떤 Supabase 프로젝트에도 연결하지 않음)
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
    return (await tx.query(sql, params)).rows[0];
  });
const cancel = (uid) => asUser(uid, "select public.billing_cancel_auto_renewal() as r");
const resume = (uid, v = CONSENT) => asUser(uid, "select public.billing_resume_auto_renewal($1) as r", [v]);
const sub = (biz) => one("select * from subscriptions where business_id = $1", [biz]);
const writable = async (biz) => (await one("select public.business_is_writable($1) as w", [biz])).w;

let seq = 0;
/** 대표 + 매장 + 결제수단(동의). status: active(이용기간 남음) / trial(결제수단 있는 체험) */
async function setup(status = "active") {
  const n = ++seq;
  const uid = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [uid, `rs-${n}@test.local`]);
  const biz = (await one(`select public.create_my_business_as($1::uuid, $2, null, null, '대표', $3) as id`,
    [uid, `연장매장${n}`, crypto.randomBytes(32).toString("hex")])).id;
  await db.query("update subscriptions set external_customer_id = $2 where business_id = $1", [biz, `mn_rs_${n}`]);
  await db.query(`select public.billing_attach_method(p_business => $1, p_customer_key => $2, p_billing_key_enc => 'enc', p_card_company => '국민',
    p_card_number_masked => '5585****', p_card_type => '신용', p_billing_cycle => 'monthly', p_consent_version => $3)`, [biz, `mn_rs_${n}`, CONSENT]);
  if (status === "active") {
    await db.query(`update subscriptions set status = 'active', current_period_start = now() - interval '10 days',
      current_period_end = now() + interval '20 days', last_payment_at = now() - interval '10 days' where business_id = $1`, [biz]);
  }
  return { uid, biz };
}

test("이용 중 해지 → 연장: active 로 돌아가고 기간은 그대로, 지금 결제 없음", async () => {
  const o = await setup("active");
  const before = await sub(o.biz);
  await cancel(o.uid);
  assert.equal((await sub(o.biz)).status, "canceled");
  const r = (await resume(o.uid)).r;
  assert.equal(r.status, "active");
  const s = await sub(o.biz);
  assert.equal(s.status, "active");
  assert.equal(s.canceled_at, null);
  assert.equal(s.current_period_end.getTime(), before.current_period_end.getTime());
  assert.equal((await one("select count(*)::int as c from subscription_payments where business_id = $1", [o.biz])).c, 0);
  assert.equal(await writable(o.biz), true);
});

test("체험 중 해지 → 연장: 체험(trial)으로 돌아가 체험 종료일에 자동결제 대상", async () => {
  const o = await setup("trial");
  const t0 = await sub(o.biz);
  await cancel(o.uid);
  const r = (await resume(o.uid)).r;
  assert.equal(r.status, "trial");
  const s = await sub(o.biz);
  assert.deepEqual([s.status, s.current_period_start, s.current_period_end, s.canceled_at], ["trial", null, null, null]);
  assert.equal(s.trial_ends_at.getTime(), t0.trial_ends_at.getTime());
});

test("연장하면 결제일에 다시 자동결제 대상이 된다", async () => {
  const o = await setup("active");
  await db.query("update subscriptions set current_period_end = now() + interval '1 minute' where business_id = $1", [o.biz]);
  await cancel(o.uid);
  let due = (await db.query("select * from public.billing_claim_due(50)")).rows.filter((r) => r.business_id === o.biz);
  assert.equal(due.length, 0, "해지 상태에서는 자동결제 대상이 아님");
  await resume(o.uid);
  due = (await db.query("select * from public.billing_claim_due(50)")).rows.filter((r) => r.business_id === o.biz);
  assert.equal(due.length, 1, "연장 후에는 결제일(오늘)에 자동결제 대상");
});

test("이용기간이 끝난 해지 구독은 연장 불가 (직접 결제로)", async () => {
  const o = await setup("active");
  await cancel(o.uid);
  await db.query("update subscriptions set current_period_end = now() - interval '1 minute' where business_id = $1", [o.biz]);
  await assert.rejects(resume(o.uid), /not_resumable/);
});

test("이미 자동 연장 중이면 아무것도 바꾸지 않는다", async () => {
  const o = await setup("active");
  const r = (await resume(o.uid)).r;
  assert.equal(r.already_active, true);
});

test("동의 문구 버전이 없으면 거부, 직원 계정은 거부", async () => {
  const o = await setup("active");
  await cancel(o.uid);
  await assert.rejects(resume(o.uid, ""), /consent_required/);
  const staff = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [staff, `rs-staff-${staff.slice(0, 6)}@test.local`]);
  await db.query("update profiles set business_id = $2, role = 'staff' where id = $1", [staff, o.biz]);
  await assert.rejects(resume(staff), /forbidden/);
  assert.equal((await sub(o.biz)).status, "canceled");
});

// 정기결제 결제수단: 카드 + 계좌 자동이체(토스 퀵계좌이체) — 로컬 전용
//   - DB: 메모리 안의 PGlite 에 schema + 마이그레이션 전체 적용 (어떤 Supabase 프로젝트에도 연결하지 않음)
//   - 토스 응답 해석: src/lib/billing/issued.ts (실제 토스 API 는 호출하지 않는다)
//   node --test tests/local/
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { parseIssuedBillingKey } from "../../src/lib/billing/issued.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, "supabase", p), "utf8");

const db = new PGlite();
await db.exec(read("tests/_supabase_stub.sql"));
await db.exec(read("schema.sql").replace(/create extension[^;]*;/gi, ""));
for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
  await db.exec(read(`migrations/${f}`));
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
async function rpc(name, args) {
  const keys = Object.keys(args);
  try {
    const r = await db.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]));
    return { data: r.rows[0]?.r ?? null, error: null };
  } catch (e) {
    return { data: null, error: { message: e.message } };
  }
}
const myMethod = (uid) =>
  db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await tx.query("set local role authenticated");
    return (await tx.query("select * from public.billing_my_payment_method()")).rows[0] ?? null;
  });

let seq = 0;
async function owner() {
  const n = ++seq;
  const uid = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [uid, `tr-${n}@test.local`]);
  const biz = (await one(`select public.create_my_business_as($1::uuid, $2, null, null, '대표', $3) as id`,
    [uid, `계좌매장${n}`, crypto.randomBytes(32).toString("hex")])).id;
  await db.query("update subscriptions set external_customer_id = $2 where business_id = $1", [biz, `mn_tr_${n}`]);
  return { n, uid, biz, key: `mn_tr_${n}` };
}
const base = (o, extra = {}) => ({
  p_business: o.biz, p_customer_key: o.key, p_billing_key_enc: `enc-${crypto.randomUUID()}`,
  p_card_company: "국민", p_card_number_masked: "5585****0000", p_card_type: "신용",
  p_billing_cycle: "monthly", p_consent_version: "draft-2026-09-30", ...extra,
});

test("토스 응답 해석: 카드 (신·구 응답 모두)", () => {
  const a = parseIssuedBillingKey({ billingKey: "bk1", method: "카드", card: { number: "43301234****123*", cardType: "체크" } });
  assert.deepEqual([a.method, a.cardNumberMasked, a.cardType, a.bankName], ["card", "43301234****123*", "체크", null]);
  const b = parseIssuedBillingKey({ billingKey: "bk2", cardCompany: "현대", cardNumber: "4330****" });
  assert.deepEqual([b.method, b.cardCompany, b.cardNumberMasked], ["card", "현대", "4330****"]);
});

test("토스 응답 해석: 계좌 자동이체 (transfers 객체/배열, 카드 정보는 버림)", () => {
  const a = parseIssuedBillingKey({ billingKey: "bk3", method: "계좌이체", transfers: { bankName: "국민은행", bankCode: "06", bankAccountNumber: "123-***-456" } });
  assert.deepEqual([a.method, a.bankName, a.accountNumberMasked, a.cardNumberMasked], ["transfer", "국민은행", "123-***-456", null]);
  const b = parseIssuedBillingKey({ billingKey: "bk4", transfers: [{ bankCode: "88", bankAccountNumber: "110-***-999" }] });
  assert.deepEqual([b.method, b.bankName, b.accountNumberMasked], ["transfer", "88", "110-***-999"]);
  assert.throws(() => parseIssuedBillingKey({ method: "계좌이체" }));
});

test("카드 연결: 기존 호출(인자 8개)은 그대로 카드로 저장된다", async () => {
  const o = await owner();
  const r = await rpc("billing_attach_method", base(o));
  assert.equal(r.error, null);
  const m = await myMethod(o.uid);
  assert.deepEqual([m.method, m.card_company, m.card_number_masked, m.bank_name], ["card", "국민", "5585****0000", null]);
});

test("계좌 자동이체 연결: 계좌 정보만 저장, 카드 칸은 비운다", async () => {
  const o = await owner();
  const r = await rpc("billing_attach_method", base(o, { p_method: "transfer", p_bank_name: "국민은행", p_account_number_masked: "123-***-456" }));
  assert.equal(r.error, null);
  const m = await myMethod(o.uid);
  assert.deepEqual([m.method, m.bank_name, m.account_number_masked, m.card_company, m.card_number_masked], ["transfer", "국민은행", "123-***-456", null, null]);
  const s = await one("select payment_method_id, auto_renew_consent_version from subscriptions where business_id = $1", [o.biz]);
  assert.ok(s.payment_method_id);
  assert.equal(s.auto_renew_consent_version, "draft-2026-09-30");
});

test("카드 → 계좌로 바꾸면 이전 카드는 replaced, 교체된 빌링키를 돌려준다", async () => {
  const o = await owner();
  const first = base(o);
  await rpc("billing_attach_method", first);
  const r = await rpc("billing_attach_method", base(o, { p_method: "transfer", p_bank_name: "신한은행", p_account_number_masked: "110-***-1" }));
  assert.equal(r.error, null);
  assert.equal(r.data.replaced_billing_key_enc, first.p_billing_key_enc);
  const rows = (await db.query("select method, status from subscription_payment_methods where business_id = $1 order by created_at", [o.biz])).rows;
  assert.deepEqual(rows.map((x) => `${x.method}:${x.status}`), ["card:replaced", "transfer:active"]);
});

test("알 수 없는 결제수단 종류는 거부", async () => {
  const o = await owner();
  const r = await rpc("billing_attach_method", base(o, { p_method: "kakaopay" }));
  assert.match(r.error?.message ?? "", /invalid_method/);
});

test("계좌 자동이체도 직접 결제·자동결제 대상이 된다 (빌링키 결제는 카드와 같은 경로)", async () => {
  const o = await owner();
  await rpc("billing_attach_method", base(o, { p_method: "transfer", p_bank_name: "국민은행", p_account_number_masked: "123-***-456" }));
  await db.query("update subscriptions set status = 'expired', expired_reason = 'payment_failed' where business_id = $1", [o.biz]);
  const { rows } = await db.query("select * from public.billing_start_manual($1, 'monthly', 'draft-2026-09-30')", [o.biz]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 10000);
  assert.ok(rows[0].billing_key_enc.startsWith("enc-"));
});

test("브라우저 권한(authenticated)은 결제수단 연결 함수를 실행할 수 없다", async () => {
  const o = await owner();
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [o.uid]);
      await tx.query("set local role authenticated");
      await tx.query("select public.billing_attach_method(p_business => $1, p_customer_key => $2, p_billing_key_enc => 'x', p_card_company => null, p_card_number_masked => null, p_card_type => null, p_billing_cycle => 'monthly', p_consent_version => 'draft-2026-09-30', p_method => 'transfer')", [o.biz, o.key]);
    }),
    /permission denied/
  );
});

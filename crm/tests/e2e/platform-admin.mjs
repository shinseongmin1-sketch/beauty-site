// 플랫폼 관리자(운영자) 화면 + 감사 로그(로그인/가입/로그아웃/화면 작업) 검증 — 실제 Edge 브라우저, 테스트 Supabase 프로젝트 전용.
//   npm run dev:test  →  node tests/e2e/platform-admin.mjs [--headless]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { loadTarget, parseArgs, mintUserToken, root } from "../../scripts/lib/env.mjs";

const args = parseArgs();
const t = loadTarget("test");
const BASE = args.base ?? "http://localhost:3100";
const run = crypto.randomBytes(3).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const shotDir = path.join(root, ".e2e-shots");
fs.mkdirSync(shotDir, { recursive: true });

const SH = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };
const svc = async (method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { ...SH, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`svc ${method} ${pq}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
};
const admin = async (method, p, body) => {
  const r = await fetch(`${t.url}/auth/v1/admin/users${p}`, { method, headers: SH, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`auth admin ${method} ${p}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};
const logs = (q) => svc("GET", `audit_logs?${q}&order=seq.asc&select=*`);
const created = [];
const mkUser = async (label) => {
  const email = `adm-${run}-${label}@gmail.com`;
  const u = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: `T-${label}` } });
  created.push(u.id);
  return { id: u.id, email };
};

const rows = [];
const record = (name, ok, note = "") => { rows.push({ name, ok, note }); console.log(`  ${ok ? "✔" : "✖"} ${name}${note ? `  — ${note}` : ""}`); };
async function check(name, fn) { try { const note = await fn(); record(name, true, note ?? ""); } catch (e) { record(name, false, e.message.split(String.fromCharCode(10))[0]); } }
const expect = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch({ channel: "msedge", headless: Boolean(args.headless), slowMo: args.headless ? 0 : 100 });
const ctx = async () => { const c = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const p = await c.newPage(); p.setDefaultTimeout(15000); return { c, p }; };
const uiLogin = async (p, email, password = PW) => {
  await p.goto(`${BASE}/login`);
  await p.fill("input[name=email]", email);
  await p.fill("input[name=password]", password);
  await p.click("button[type=submit]");
};
const bodyText = (p) => p.locator("body").innerText();

// 화면에 나오면 안 되는 개인정보 표식
const PII = { custName: `운영자비열람고객${run}`, custPhone: "010-5555-6666", memo: `운영자비열람메모${run}` };

console.log(`\n▶ 대상: ${BASE} → 테스트 Supabase(${t.ref})\n`);

try {
  // ── 셋업 ────────────────────────────────────────────────────────────
  const OA = await mkUser("owner"), PA = await mkUser("padmin");
  const tokenOA = await mintUserToken(t, { id: OA.id, email: OA.email });
  const bizName = `운영자시험-${run}`, repName = `대표${run}`;
  const bizA = (await (await fetch(`${t.url}/rest/v1/rpc/create_my_business`, { method: "POST", headers: { apikey: t.anonKey, Authorization: `Bearer ${tokenOA}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_name: bizName, p_representative_name: repName, p_business_number_hash: crypto.randomBytes(32).toString("hex"), p_business_number_masked: "123-**-***45" }) })).json());
  const cust = (await svc("POST", "customers", { business_id: bizA, name: PII.custName, phone: PII.custPhone, memo: PII.memo }))[0].id;
  const start = new Date(Date.now() + 86_400_000).toISOString(), end = new Date(Date.now() + 90_000_000).toISOString();
  await svc("POST", "reservations", { business_id: bizA, customer_id: cust, start_time: start, end_time: end });
  await svc("POST", "payments", { business_id: bizA, customer_id: cust, gross_amount: 1000, amount: 1000, status: "paid" });
  await svc("POST", "platform_admins", { user_id: PA.id });

  // ── 접근 통제 ───────────────────────────────────────────────────────
  await check("비로그인: /admin 접근 → 로그인 화면으로 이동", async () => {
    const { p } = await ctx();
    await p.goto(`${BASE}/admin`);
    await p.waitForURL(/\/login/);
    expect(p.url().includes("next=%2Fadmin") || p.url().includes("next=/admin"), `next 파라미터: ${p.url()}`);
  });

  const o = await ctx();
  await check("일반 사업장 대표: 로그인 → /admin·하위 페이지 모두 404 (운영자 화면 존재 자체를 드러내지 않음)", async () => {
    await uiLogin(o.p, OA.email);
    await o.p.waitForURL(/\/dashboard/);
    for (const u of ["/admin", "/admin/businesses", "/admin/audit", `/admin/businesses/${bizA}`]) {
      const resp = await o.p.goto(`${BASE}${u}`);
      const text = await bodyText(o.p);
      expect(resp.status() === 404, `${u} → ${resp.status()}`);
      expect(!text.includes("운영 현황") && !text.includes("PLATFORM ADMIN") && !text.includes(bizName), `${u} 에 운영자 내용이 보임`);
    }
    await o.p.screenshot({ path: path.join(shotDir, "adm-1-owner-404.png") });
  });

  // ── 로그인/가입/화면 작업 로그 ─────────────────────────────────────
  await check("감사 로그: 대표 로그인 성공 → auth.login (actor=owner, 사업장 연결), 이메일 등 개인정보 없음", async () => {
    const l = await logs(`action=eq.auth.login&actor_user_id=eq.${OA.id}&result=eq.success`);
    expect(l.length >= 1 && l[0].actor_type === "owner" && l[0].business_id === bizA, JSON.stringify(l[0]));
    expect(!JSON.stringify(l).includes(OA.email) && !JSON.stringify(l).includes(OA.email.split("@")[0]), "로그에 이메일이 있음");
  });
  await check("감사 로그: 로그인 실패(잘못된 비밀번호) → auth.login failure (actor 없음, 원인 코드만, 이메일 없음)", async () => {
    const n0 = (await logs("action=eq.auth.login&result=eq.failure")).length;
    const { p } = await ctx();
    await uiLogin(p, OA.email, "wrong-password-123");
    await p.waitForURL(/error=/);
    await p.waitForTimeout(800);
    const l = await logs("action=eq.auth.login&result=eq.failure");
    expect(l.length === n0 + 1, `실패 로그 ${l.length - n0}건 증가`);
    const last = l[l.length - 1];
    expect(last.actor_user_id === null && last.actor_type === "system" && last.metadata.reason === "invalid_credentials", JSON.stringify(last));
    expect(!JSON.stringify(last).includes(OA.email) && !JSON.stringify(last).includes("wrong-password"), "이메일/비밀번호가 로그에 있음");
  });
  await check("감사 로그: 화면에서 고객 등록·매장 설정 변경 → customer.create / business.update (actor=owner, 변경 컬럼 이름만)", async () => {
    await o.p.goto(`${BASE}/dashboard/customers`);
    const f = o.p.locator("form:has(input[name=name][placeholder='이름'])").first();
    await f.locator("input[name=name]").fill(`화면등록고객${run}`);
    await f.locator("input[name=phone]").fill("010-9090-8080");
    await f.locator("button[type=submit]").click();
    await o.p.waitForSelector(`text=화면등록고객${run}`);
    await o.p.goto(`${BASE}/dashboard/settings`);
    await o.p.locator("input[name=address]").fill("부산 해운대");
    await o.p.locator("form button[type=submit]").last().click();
    await o.p.waitForTimeout(1500);
    const c = await logs(`action=eq.customer.create&business_id=eq.${bizA}&actor_user_id=eq.${OA.id}`);
    expect(c.length === 1 && c[0].actor_type === "owner" && c[0].resource_id, "customer.create");
    const b = await logs(`action=eq.business.update&business_id=eq.${bizA}&actor_user_id=eq.${OA.id}`);
    expect(b.length >= 1 && b[b.length - 1].metadata.changed_fields.includes("address"), JSON.stringify(b[b.length - 1]?.metadata));
    const dump = JSON.stringify(await logs(`business_id=eq.${bizA}`));
    for (const v of [`화면등록고객${run}`, "010-9090-8080", "부산 해운대", PII.custName, PII.custPhone, PII.memo]) expect(!dump.includes(v), `로그에 원문(${v})이 있음`);
  });
  await check("감사 로그: 화면 회원가입 → auth.signup (actor=신규 계정, 이메일 없음) / 로그아웃 → auth.logout", async () => {
    const { p } = await ctx();
    const email = `adm-${run}-signup@gmail.com`;
    await p.goto(`${BASE}/signup`);
    await p.fill("input[name=full_name]", "가입시험");
    await p.fill("input[name=email]", email);
    await p.fill("input[name=password]", PW);
    await p.click("button[type=submit]");
    await p.waitForURL(/\/onboarding/);
    const id = (await admin("GET", "?per_page=200")).users.find((u) => u.email === email)?.id;
    created.push(id);
    const s = await logs(`action=eq.auth.signup&actor_user_id=eq.${id}`);
    expect(s.length === 1 && s[0].result === "success", `signup 로그 ${s.length}건`);
    expect(!JSON.stringify(s).includes(email), "가입 로그에 이메일이 있음");
    // 로그아웃 기록: 대표 세션에서
    await o.p.goto(`${BASE}/dashboard`);
    await o.p.click("text=로그아웃");
    await o.p.waitForURL(/\/login/);
    await o.p.waitForTimeout(600);
    const lo = await logs(`action=eq.auth.logout&actor_user_id=eq.${OA.id}`);
    expect(lo.length === 1 && lo[0].actor_type === "owner", `logout 로그 ${lo.length}건`);
  });

  // ── 운영자 화면 ─────────────────────────────────────────────────────
  const a = await ctx();
  await check("운영자: 로그인하면 운영자 화면(/admin)으로 이동, 운영 현황 표시 + 통계가 실제 DB 와 일치", async () => {
    await uiLogin(a.p, PA.email);
    await a.p.waitForURL(/\/admin/);
    await a.p.waitForSelector("text=운영 현황");
    const stat = async (label) => Number((await a.p.locator(`[data-stat="${label}"]`).innerText()).replace(/,/g, ""));
    const total = (await svc("GET", "businesses?select=id")).length;
    expect((await stat("전체 사업장")) === total, `전체 ${await stat("전체 사업장")} ≠ ${total}`);
    const subs = await svc("GET", "subscriptions?select=status,trial_ends_at");
    const now = Date.now();
    const trial = subs.filter((s) => s.status === "trial" && new Date(s.trial_ends_at) > now).length;
    const exp = subs.filter((s) => s.status === "expired" || (s.status === "trial" && new Date(s.trial_ends_at) <= now)).length;
    expect((await stat("무료체험 중")) === trial && (await stat("체험 종료")) === exp, `체험 ${await stat("무료체험 중")}/${trial}, 종료 ${await stat("체험 종료")}/${exp}`);
    const text = await bodyText(a.p);
    for (const label of ["최근 가입 사업장", "최근 무료체험 시작", "최근 무료체험 종료", "최근 문의"]) expect(text.includes(label), `${label} 없음`);
    expect(text.includes(bizName), "최근 가입 사업장에 시험 사업장이 없음");
    await a.p.screenshot({ path: path.join(shotDir, "adm-2-dashboard.png"), fullPage: true });
    const l = await logs(`action=eq.auth.login&actor_user_id=eq.${PA.id}&result=eq.success`);
    expect(l.length >= 1 && l[0].actor_type === "platform_admin", "운영자 로그인이 platform_admin 으로 기록됨");
  });
  await check("운영자: 사업장 검색 — 사업장명/대표자명으로 검색, 상태·가입일 필터, 사업자번호는 검색 불가", async () => {
    const search = async (params) => { await a.p.goto(`${BASE}/admin/businesses?${new URLSearchParams(params)}`); await a.p.waitForSelector("table"); return bodyText(a.p); };
    expect((await search({ q: bizName })).includes(bizName), "사업장명 검색");
    expect((await search({ q: repName })).includes(bizName), "대표자명 검색");
    for (const q of ["1234500", "123-45", "123-**-***45", "12345"]) {
      const text = await search({ q });
      expect(text.includes("검색 결과가 없습니다") && !text.includes(bizName), `사업자번호(${q})로 검색됨`);
    }
    expect((await search({ q: bizName, status: "trial" })).includes(bizName), "상태 필터 trial");
    expect((await search({ q: bizName, status: "suspended" })).includes("검색 결과가 없습니다"), "상태 필터 suspended");
    expect((await search({ q: bizName, from: "2999-01-01" })).includes("검색 결과가 없습니다"), "가입일 필터");
    expect((await search({ q: "%" })).includes("검색 결과가 없습니다"), "% 와일드카드");
    await a.p.screenshot({ path: path.join(shotDir, "adm-3-search.png"), fullPage: true });
  });
  await check("운영자: 사업장 상세 — 이름/대표자명/가입일/체험 기간/상태/직원·고객·예약·매출 건수/마지막 활동, 개인정보는 없음", async () => {
    await a.p.goto(`${BASE}/admin/businesses?${new URLSearchParams({ q: bizName })}`);
    await a.p.click(`a:has-text("${bizName}")`);
    await a.p.waitForSelector(`h1:has-text("${bizName}")`);
    const count = async (label) => Number((await a.p.locator(`[data-count="${label}"]`).innerText()).replace(/,/g, ""));
    expect((await count("고객 수")) === (await svc("GET", `customers?business_id=eq.${bizA}&select=id`)).length, "고객 수");
    expect((await count("예약 수")) === 1 && (await count("매출 건수")) === 1, "예약/매출 건수");
    expect((await count("등록된 직원(담당자)")) === (await svc("GET", `staff?business_id=eq.${bizA}&select=id`)).length, "직원 수");
    const text = await bodyText(a.p);
    for (const s of [repName, "가입일", "무료체험 시작", "무료체험 종료", "현재 상태", "마지막 활동", "123-**-***45", "무료체험 중"]) expect(text.includes(s), `상세에 '${s}' 없음`);
    for (const v of [PII.custName, PII.custPhone, PII.memo, `화면등록고객${run}`, "010-9090-8080", OA.email]) expect(!text.includes(v), `운영자 상세에 개인정보(${v})가 보임`);
    await a.p.screenshot({ path: path.join(shotDir, "adm-4-detail.png"), fullPage: true });
    const v = await logs(`action=eq.platform.business_view&business_id=eq.${bizA}&actor_user_id=eq.${PA.id}`);
    expect(v.length >= 1 && v[0].actor_type === "platform_admin", "상세 열람 로그");
  });
  await check("운영자: 감사 로그 화면 — 조회/필터 가능, 수정·삭제 UI 없음, 개인정보 없음", async () => {
    await a.p.goto(`${BASE}/admin/audit?business=${bizA}`);
    await a.p.waitForSelector("table");
    const text = await bodyText(a.p);
    for (const s of ["customer.create", "business.create", "trial.start", "platform.business_view", "운영자", "대표"]) expect(text.includes(s), `로그 화면에 '${s}' 없음`);
    for (const v of [PII.custName, PII.custPhone, PII.memo, `화면등록고객${run}`, OA.email]) expect(!text.includes(v), `감사 로그 화면에 개인정보(${v})가 보임`);
    expect((await a.p.locator("button:has-text('삭제'), button:has-text('수정')").count()) === 0, "감사 로그 화면에 수정/삭제 버튼이 있음");
    await a.p.goto(`${BASE}/admin/audit?action=customer.create`);
    await a.p.waitForSelector("table");
    expect((await bodyText(a.p)).includes("customer.create"), "행위 필터");
    await a.p.screenshot({ path: path.join(shotDir, "adm-5-audit.png"), fullPage: true });
  });
  await check("운영자는 일반 매장 권한이 없다: /dashboard 로 가면 사업장 없음(온보딩)으로 이동 — 매장 데이터에 접근 불가", async () => {
    await a.p.goto(`${BASE}/dashboard/customers`);
    await a.p.waitForURL(/\/onboarding/);
    expect(!(await bodyText(a.p)).includes(PII.custName), "운영자가 고객 정보를 봄");
  });
  await check("운영자 비활성화 시 즉시 접근 불가 (DB 가 매 요청마다 확인)", async () => {
    await svc("PATCH", `platform_admins?user_id=eq.${PA.id}`, { active: false });
    const resp = await a.p.goto(`${BASE}/admin`);
    expect(resp.status() === 404, `비활성 운영자가 접근: ${resp.status()}`);
    await svc("PATCH", `platform_admins?user_id=eq.${PA.id}`, { active: true });
    const ok = await a.p.goto(`${BASE}/admin`);
    expect(ok.status() === 200, `재활성 후 접근 불가: ${ok.status()}`);
  });
  await check("운영자 로그아웃 → auth.logout (actor=platform_admin), 이후 /admin 은 로그인 요구", async () => {
    await a.p.click("text=로그아웃");
    await a.p.waitForURL(/\/login/);
    await a.p.waitForTimeout(600);
    const lo = await logs(`action=eq.auth.logout&actor_user_id=eq.${PA.id}`);
    expect(lo.length === 1 && lo[0].actor_type === "platform_admin", `${lo.length}건`);
    await a.p.goto(`${BASE}/admin`);
    await a.p.waitForURL(/\/login/);
  });
} catch (e) {
  record("테스트 스크립트 오류", false, e.message.split(String.fromCharCode(10))[0]);
} finally {
  await browser.close();
  const all = await fetch(`${t.url}/auth/v1/admin/users?per_page=200`, { headers: SH }).then((r) => r.json()).catch(() => ({ users: [] }));
  for (const u of (all.users ?? []).filter((u) => /^adm-[0-9a-f]+-/.test(u.email ?? ""))) await fetch(`${t.url}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: SH }).catch(() => {});
}
const failed = rows.filter((r) => !r.ok);
console.log(`\n결과: ${rows.length - failed.length}/${rows.length} 통과`);
if (failed.length) { console.log("\n실패:"); for (const f of failed) console.log(`  ${f.name}: ${f.note}`); }
process.exit(failed.length ? 1 : 0);

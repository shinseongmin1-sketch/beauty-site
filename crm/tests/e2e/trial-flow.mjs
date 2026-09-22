// 무료체험/구독 화면 검증 — 실제 Edge 브라우저, 테스트 Supabase 프로젝트 전용.
//   npm run dev:test  →  node tests/e2e/trial-flow.mjs [--headless]
// 사업자번호는 실행마다 무작위로 만든다 (무료체험 이력은 계정 삭제 후에도 남는 것이 정책이라 재사용하면 거부된다).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { loadTarget, parseArgs, root } from "../../scripts/lib/env.mjs";

const args = parseArgs();
const t = loadTarget("test");
const BASE = args.base ?? "http://localhost:3100";
const run = crypto.randomBytes(3).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const shotDir = path.join(root, ".e2e-shots");
fs.mkdirSync(shotDir, { recursive: true });
if (!t.pepper) throw new Error(".env.test 에 BUSINESS_NUMBER_PEPPER 가 필요합니다.");

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
const userIdByEmail = async (email) => (await admin("GET", "?per_page=200")).users.find((u) => u.email === email)?.id;

const rows = [];
const record = (name, ok, note = "") => { rows.push({ name, ok, note }); console.log(`  ${ok ? "✔" : "✖"} ${name}${note ? `  — ${note}` : ""}`); };
async function check(name, fn) { try { const note = await fn(); record(name, true, note ?? ""); } catch (e) { record(name, false, e.message.split(String.fromCharCode(10))[0]); } }
const expect = (c, m) => { if (!c) throw new Error(m); };

const digitsN = () => String(Math.floor(1e9 + Math.random() * 9e9));
const fmt = (d) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
const hmac = (scope, digits) => crypto.createHmac("sha256", t.pepper).update(`${scope}:v1:${digits}`).digest("hex");

const browser = await chromium.launch({ channel: "msedge", headless: Boolean(args.headless), slowMo: args.headless ? 0 : 120 });
async function ctx() { const c = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const p = await c.newPage(); p.setDefaultTimeout(15000); return { c, p }; }

// 전화번호는 보조 신호(같은 번호 3곳까지)라, 테스트도 계정마다 다른 번호를 쓴다
const randomPhone = () => `02-${String(Math.floor(1e7 + Math.random() * 9e7))}`;
async function signupOnboard(p, label, number, { phone = randomPhone() } = {}) {
  const email = `trl-${run}-${label.toLowerCase()}@gmail.com`;
  await p.goto(`${BASE}/signup`);
  await p.fill("input[name=full_name]", `${label}대표`);
  await p.fill("input[name=email]", email);
  await p.fill("input[name=password]", PW);
  await p.click("button[type=submit]");
  await p.waitForURL(/\/onboarding/);
  await p.fill("input[name=name]", `체험시험-${label}-${run}`);
  await p.fill("input[name=representative_name]", `${label}대표`);
  await p.fill("input[name=business_number]", number);
  await p.fill("input[name=phone]", phone);
  await p.fill("input[name=address]", "서울");
  await p.click("button[type=submit]");
  await p.waitForURL(/\/dashboard/);
  await p.waitForLoadState("networkidle").catch(() => {});
  return { email, id: await userIdByEmail(email) };
}
const bizOf = async (uid) => (await svc("GET", `profiles?id=eq.${uid}&select=business_id`))[0].business_id;
const subOf = async (biz) => (await svc("GET", `subscriptions?business_id=eq.${biz}&select=*`))[0];
const headerText = (p) => p.locator("header").first().innerText();
const bannerText = async (p) => (await p.locator("[role=status]").allInnerTexts()).join(" ");

async function capture(page, trigger) {
  const got = [];
  const h = (req) => { if (req.method() === "POST" && req.headers()["next-action"]) got.push({ url: req.url(), headers: req.headers(), body: req.postDataBuffer() }); };
  page.on("request", h);
  await trigger();
  await page.waitForTimeout(2000);
  page.off("request", h);
  expect(got.length > 0, "Server Action 요청을 캡처하지 못함");
  return got[0];
}
async function replay(c, cap, swaps = []) {
  let body = cap.body ? cap.body.toString("utf8") : "";
  for (const [from, to] of swaps) body = body.split(from).join(to);
  const headers = {};
  for (const k of ["content-type", "next-action", "next-router-state-tree", "accept"]) if (cap.headers[k]) headers[k] = cap.headers[k];
  return (await c.request.post(cap.url, { headers, data: Buffer.from(body, "utf8"), maxRedirects: 0, failOnStatusCode: false })).status();
}

console.log(`\n▶ 대상: ${BASE} → 테스트 Supabase(${t.ref})\n`);

const NUM = digitsN();     // A/B/C 가 같이 쓰는 사업자번호 (1111111111 시나리오)
const NUM_D = digitsN();   // D 는 다른 번호
let A, B, C, D, bizA;

try {
  // ── 화면 문구 ──────────────────────────────────────────────────────
  await check("가입/온보딩 화면 문구: '3개월 무료체험' + 사업장당 1회 + 사업자번호 원문 미저장 안내", async () => {
    const { p } = await ctx();
    await p.goto(`${BASE}/signup`);
    const s = await p.locator("body").innerText();
    expect(s.includes("3개월 무료체험") && s.includes("사업장(사업자등록번호)당 최초 1회"), "가입 화면 문구 불일치");
    const email = `trl-${run}-copy@gmail.com`;
    await p.fill("input[name=full_name]", "문구"); await p.fill("input[name=email]", email); await p.fill("input[name=password]", PW);
    await p.click("button[type=submit]"); await p.waitForURL(/\/onboarding/);
    const o = await p.locator("body").innerText();
    expect(o.includes("대표자명") && o.includes("사업자등록번호") && o.includes("3개월 무료체험") && o.includes("원문은 저장하지 않고"), "온보딩 문구/필드 누락");
    await p.screenshot({ path: path.join(shotDir, "trial-1-onboarding.png"), fullPage: true });
    const bad = await p.evaluate(() => { const f = document.querySelector("input[name=business_number]"); return f && f.required; });
    expect(bad, "사업자등록번호가 필수 입력이 아님");
  });

  await check("온보딩: 사업자번호 형식 오류(9자리)는 한글 안내로 거부", async () => {
    const { p } = await ctx();
    const email = `trl-${run}-fmt@gmail.com`;
    await p.goto(`${BASE}/signup`);
    await p.fill("input[name=full_name]", "형식"); await p.fill("input[name=email]", email); await p.fill("input[name=password]", PW);
    await p.click("button[type=submit]"); await p.waitForURL(/\/onboarding/);
    await p.fill("input[name=name]", "형식시험"); await p.fill("input[name=representative_name]", "대표"); await p.fill("input[name=business_number]", "123-45-6789");
    await p.click("button[type=submit]");
    await p.waitForSelector("text=사업자등록번호 10자리를 정확히 입력해주세요.");
    expect(new URL(p.url()).pathname === "/onboarding", "온보딩을 벗어남");
  });

  // ── A: 1111111111 시나리오 ────────────────────────────────────────
  const a = await ctx();
  await check("A: 사업자번호로 가입 → 3개월 무료체험 시작, 헤더에 남은 일수 표시, 차단 배너 없음", async () => {
    A = await signupOnboard(a.p, "A", fmt(NUM));
    bizA = await bizOf(A.id);
    const s = await subOf(bizA);
    expect(s.status === "trial" && s.trial_denied_reason === null, `상태 ${s.status}/${s.trial_denied_reason}`);
    const days = (new Date(s.trial_ends_at) - new Date(s.trial_started_at)) / 86_400_000;
    expect(days >= 89 && days <= 92, `체험 ${days}일`);
    const h = await headerText(a.p);
    expect(/무료체험 \d+일 남음/.test(h), `헤더: ${h.replace(/\s+/g, " ")}`);
    expect(!(await bannerText(a.p)).includes("이미 무료체험"), "체험이 지급됐는데 거부 배너가 보임");
    await a.p.screenshot({ path: path.join(shotDir, "trial-2-A-dashboard.png"), fullPage: true });
    return h.match(/무료체험 \d+일 남음/)[0];
  });
  await check("A: 사업자번호는 해시(HMAC)+마스킹만 저장 — 서버 비밀값으로 만든 값과 일치, 원문/하이픈 형식은 DB 어디에도 없음", async () => {
    const [b] = await svc("GET", `businesses?id=eq.${bizA}&select=*`);
    expect(b.business_number_hash === hmac("bn", NUM), "해시가 서버 비밀값(pepper) 기반 HMAC 과 다름");
    expect(b.business_number_masked === `${NUM.slice(0, 3)}-**-***${NUM.slice(8)}`, `마스킹 ${b.business_number_masked}`);
    const dump = JSON.stringify(await svc("GET", `trial_history?business_number_hash=eq.${b.business_number_hash}&select=*`)) + JSON.stringify(b);
    expect(!dump.includes(NUM) && !dump.includes(fmt(NUM)), "사업자번호 원문이 DB 에 있음");
    expect(b.representative_name === "A대표", "대표자명 저장 안 됨");
  });
  await check("무료체험 중: 화면에서 고객 등록 가능", async () => {
    await a.p.goto(`${BASE}/dashboard/customers`);
    const f = a.p.locator("form:has(input[name=name][placeholder='이름'])").first();
    await f.locator("input[name=name]").fill("체험중고객");
    await f.locator("button[type=submit]").click();
    await a.p.waitForSelector("text=체험중고객");
    expect((await svc("GET", `customers?business_id=eq.${bizA}&name=eq.${encodeURIComponent("체험중고객")}&select=id`)).length === 1, "저장 안 됨");
  });

  // ── B: 같은 번호, 다른 표기(하이픈 없음) ──────────────────────────
  const b = await ctx();
  await check("B: 같은 사업자번호(표기만 다름)로 새 계정 가입 → 무료체험 거부 배너, 이력 1건 그대로", async () => {
    B = await signupOnboard(b.p, "B", NUM);
    const bizB = await bizOf(B.id);
    const s = await subOf(bizB);
    expect(s.status === "expired" && s.trial_denied_reason === "business_number_used", `${s.status}/${s.trial_denied_reason}`);
    const text = await bannerText(b.p);
    expect(text.includes("이미 무료체험을 이용하셨습니다") && text.includes("조회와 내보내기"), `배너: ${text.slice(0, 80)}`);
    expect(!/무료체험 \d+일 남음/.test(await headerText(b.p)), "거부됐는데 남은 일수가 보임");
    expect((await svc("GET", `trial_history?business_number_hash=eq.${hmac("bn", NUM)}&select=id`)).length === 1, "이력 중복");
    await b.p.screenshot({ path: path.join(shotDir, "trial-3-B-denied.png"), fullPage: true });
  });
  await check("B(체험 거부): 조회 화면은 열리고, 화면에서 고객 등록 시도는 차단(서버 액션) + 안내", async () => {
    await b.p.goto(`${BASE}/dashboard/customers`);
    await b.p.waitForSelector("text=고객");
    const f = b.p.locator("form:has(input[name=name][placeholder='이름'])").first();
    await f.locator("input[name=name]").fill("거부계정고객");
    await f.locator("button[type=submit]").click();
    await b.p.waitForURL((u) => u.pathname === "/dashboard");
    expect((await bannerText(b.p)).includes("이미 무료체험"), "차단 후 안내 배너가 없음");
    expect((await svc("GET", `customers?business_id=eq.${await bizOf(B.id)}&select=id`)).length === 0, "차단됐어야 할 고객이 저장됨");
    for (const u of ["/dashboard/reservations", "/dashboard/consultations", "/dashboard/customers", "/dashboard/sales/history"]) {
      const resp = await b.p.goto(`${BASE}${u}`);
      await b.p.waitForLoadState("networkidle").catch(() => {});
      expect(resp.status() === 200 && new URL(b.p.url()).pathname === u, `${u} 조회 불가 → ${b.p.url()}`);
    }
  });

  // ── A 탈퇴 → C ───────────────────────────────────────────────────
  await check("A 계정 탈퇴(삭제) 후 같은 사업자번호로 C 가입 → 무료체험 거부 (이력은 남아 있음)", async () => {
    await admin("DELETE", `/${A.id}`);
    expect((await svc("GET", `businesses?id=eq.${bizA}&select=id`)).length === 0, "A 사업장이 남아 있음");
    const hist = await svc("GET", `trial_history?business_number_hash=eq.${hmac("bn", NUM)}&select=business_id`);
    expect(hist.length === 1 && hist[0].business_id === null, `이력: ${JSON.stringify(hist)}`);
    const c = await ctx();
    C = await signupOnboard(c.p, "C", fmt(NUM));
    const s = await subOf(await bizOf(C.id));
    expect(s.status === "expired" && s.trial_denied_reason === "business_number_used", `${s.status}`);
    expect((await bannerText(c.p)).includes("이미 무료체험을 이용하셨습니다"), "거부 배너 없음");
    expect((await svc("GET", `trial_history?business_number_hash=eq.${hmac("bn", NUM)}&select=id`)).length === 1, "재가입으로 이력이 늘어남");
  });

  // ── D: 다른 번호 ─────────────────────────────────────────────────
  const d = await ctx();
  await check("D: 다른 사업자번호로 가입 → 무료체험 가능", async () => {
    D = await signupOnboard(d.p, "D", fmt(NUM_D));
    const s = await subOf(await bizOf(D.id));
    expect(s.status === "trial", s.status);
    expect(/무료체험 \d+일 남음/.test(await headerText(d.p)), "남은 일수 미표시");
  });

  // ── 체험 종료: 조회 허용 / 쓰기 차단 (화면 + 서버 액션 재전송) ─────
  await check("체험 종료 후(D): 로그인 유지·조회 가능, 화면 등록 시도 차단, 캡처한 등록 요청 재전송도 차단, 종료 배너 표시", async () => {
    const bizD = await bizOf(D.id);
    await d.p.goto(`${BASE}/dashboard/customers`);
    const f = d.p.locator("form:has(input[name=name][placeholder='이름'])").first();
    // 체험 중에 등록 요청을 캡처 (정상 등록 1건)
    const cap = await capture(d.p, async () => { await f.locator("input[name=name]").fill("체험중D고객"); await f.locator("button[type=submit]").click(); });
    await d.p.waitForSelector("text=체험중D고객");
    expect((await svc("GET", `customers?business_id=eq.${bizD}&select=id`)).length === 1, "체험 중 등록이 안 됨");

    // 체험 종료 (DB 시각을 과거로)
    const past = new Date(Date.now() - 86_400_000).toISOString(), started = new Date(Date.now() - 91 * 86_400_000).toISOString();
    await svc("PATCH", `subscriptions?business_id=eq.${bizD}`, { trial_started_at: started, trial_ends_at: past });
    await svc("PATCH", `trial_history?business_id=eq.${bizD}`, { trial_started_at: started, trial_ends_at: past });

    await d.p.goto(`${BASE}/dashboard`);
    await d.p.waitForLoadState("networkidle").catch(() => {});
    expect(new URL(d.p.url()).pathname === "/dashboard", "체험 종료 후 로그인/대시보드 접근이 막힘");
    const text = await bannerText(d.p);
    expect(text.includes("무료체험이 종료되었습니다") && text.includes("조회와 내보내기"), `배너: ${text.slice(0, 80)}`);
    await d.p.screenshot({ path: path.join(shotDir, "trial-4-D-expired.png"), fullPage: true });
    // 서버가 로그인 시점에 저장 상태도 맞춘다 (sync)
    await d.p.waitForTimeout(500);
    expect((await subOf(bizD)).status === "expired", `저장 상태 ${(await subOf(bizD)).status}`);

    // 조회: 기존 데이터 보임
    await d.p.goto(`${BASE}/dashboard/customers`);
    await d.p.waitForSelector("text=체험중D고객");
    // 화면에서 등록 시도 → 차단
    const f2 = d.p.locator("form:has(input[name=name][placeholder='이름'])").first();
    await f2.locator("input[name=name]").fill("종료후고객");
    await f2.locator("button[type=submit]").click();
    await d.p.waitForURL((u) => u.pathname === "/dashboard");
    // 캡처해 둔 (체험 중 유효했던) 등록 요청을 그대로 재전송 → 차단
    const st = await replay(d.c, cap, [["체험중D고객", "재전송고객"]]);
    const names = (await svc("GET", `customers?business_id=eq.${bizD}&select=name`)).map((r) => r.name).sort();
    expect(names.length === 1 && names[0] === "체험중D고객", `종료 후 고객이 생김: ${names.join(",")}`);
    return `재전송 HTTP ${st}, 데이터 그대로`;
  });
  await check("체험 종료 후(D): 예약·상담·매출 조회 화면 정상, 사이드 메뉴/권한 구조는 그대로", async () => {
    for (const u of ["/dashboard/reservations", "/dashboard/consultations", "/dashboard/sales", "/dashboard/sales/history", "/dashboard/staff", "/dashboard/settings"]) {
      const resp = await d.p.goto(`${BASE}${u}`);
      await d.p.waitForLoadState("networkidle").catch(() => {});
      expect(resp.status() === 200 && new URL(d.p.url()).pathname === u, `${u} → ${d.p.url()}`);
    }
  });
  await check("체험 종료 후(D): 설정 저장 시도도 차단(서버 액션), 대표자명/사업자번호(마스킹) 표시", async () => {
    await d.p.goto(`${BASE}/dashboard/settings`);
    expect((await d.p.locator("body").innerText()).includes(`${NUM_D.slice(0, 3)}-**-***${NUM_D.slice(8)}`), "마스킹된 사업자번호 미표시");
    await d.p.locator("input[name=name]").fill("종료후이름변경");
    await d.p.locator("form button[type=submit]").last().click();
    await d.p.waitForURL((u) => u.pathname === "/dashboard");
    const [bz] = await svc("GET", `businesses?id=eq.${await bizOf(D.id)}&select=name`);
    expect(bz.name === `체험시험-D-${run}`, `사업장명이 바뀜: ${bz.name}`);
  });

  // ── 기존(백필) 사업장: 설정에서 사업자번호 사후 등록 ────────────────
  await check("기존 사업장(사업자번호 없음): 설정에서 등록 → 마스킹 표시 + 서버 비밀값 해시로 저장, 이후 변경 불가", async () => {
    const email = `trl-${run}-legacy@gmail.com`;
    const u = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: "기존대표" } });
    const biz = (await svc("POST", "businesses", { owner_id: u.id, name: `기존-${run}` }))[0].id;
    await svc("PATCH", `profiles?id=eq.${u.id}`, { business_id: biz, role: "owner" });
    const now = Date.now();
    await svc("POST", "subscriptions", { business_id: biz, status: "trial", trial_source: "legacy_backfill", trial_started_at: new Date(now).toISOString(), trial_ends_at: new Date(now + 90 * 86_400_000).toISOString() });
    await svc("POST", "trial_history", { business_id: biz, source: "legacy_backfill", trial_started_at: new Date(now).toISOString(), trial_ends_at: new Date(now + 90 * 86_400_000).toISOString() });
    const l = await ctx();
    await l.p.goto(`${BASE}/login`); await l.p.fill("input[name=email]", email); await l.p.fill("input[name=password]", PW); await l.p.click("button[type=submit]"); await l.p.waitForURL(/\/dashboard/);
    await l.p.goto(`${BASE}/dashboard/settings`);
    const num = digitsN();
    await l.p.locator("input[name=representative_name]").fill("기존대표자");
    await l.p.locator("input[name=business_number]").fill(fmt(num));
    await l.p.locator("form button[type=submit]").last().click();
    await l.p.waitForTimeout(1500);
    await l.p.goto(`${BASE}/dashboard/settings`);
    const text = await l.p.locator("body").innerText();
    expect(text.includes(`${num.slice(0, 3)}-**-***${num.slice(8)}`) && text.includes("변경할 수 없습니다"), "마스킹 표시/잠금 안 됨");
    const [bz] = await svc("GET", `businesses?id=eq.${biz}&select=business_number_hash,representative_name`);
    expect(bz.business_number_hash === hmac("bn", num) && bz.representative_name === "기존대표자", "저장값 불일치");
    expect((await l.p.locator("input[name=business_number]").count()) === 0, "등록 후에도 입력창이 남아 있음");
    // 이미 다른 사업장이 쓴 번호는 등록 불가
    const email2 = `trl-${run}-legacy2@gmail.com`;
    const u2 = await admin("POST", "", { email: email2, password: PW, email_confirm: true, user_metadata: { full_name: "기존대표2" } });
    const biz2 = (await svc("POST", "businesses", { owner_id: u2.id, name: `기존2-${run}` }))[0].id;
    await svc("PATCH", `profiles?id=eq.${u2.id}`, { business_id: biz2, role: "owner" });
    await svc("POST", "subscriptions", { business_id: biz2, status: "trial", trial_source: "legacy_backfill", trial_started_at: new Date(now).toISOString(), trial_ends_at: new Date(now + 90 * 86_400_000).toISOString() });
    await svc("POST", "trial_history", { business_id: biz2, source: "legacy_backfill", trial_started_at: new Date(now).toISOString(), trial_ends_at: new Date(now + 90 * 86_400_000).toISOString() });
    const l2 = await ctx();
    await l2.p.goto(`${BASE}/login`); await l2.p.fill("input[name=email]", email2); await l2.p.fill("input[name=password]", PW); await l2.p.click("button[type=submit]"); await l2.p.waitForURL(/\/dashboard/);
    await l2.p.goto(`${BASE}/dashboard/settings`);
    await l2.p.locator("input[name=business_number]").fill(num);
    await l2.p.locator("form button[type=submit]").last().click();
    await l2.p.waitForSelector("text=이미 다른 사업장에서 사용 중인 사업자등록번호입니다.");
  });
} catch (e) {
  record("테스트 스크립트 오류", false, e.message.split(String.fromCharCode(10))[0]);
} finally {
  await browser.close();
  const all = await fetch(`${t.url}/auth/v1/admin/users?per_page=200`, { headers: SH }).then((r) => r.json()).catch(() => ({ users: [] }));
  for (const u of (all.users ?? []).filter((u) => /^trl-[0-9a-f]+-/.test(u.email ?? ""))) await fetch(`${t.url}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: SH }).catch(() => {});
}
const failed = rows.filter((r) => !r.ok);
console.log(`\n결과: ${rows.length - failed.length}/${rows.length} 통과`);
if (failed.length) { console.log("\n실패:"); for (const f of failed) console.log(`  ${f.name}: ${f.note}`); }
process.exit(failed.length ? 1 : 0);

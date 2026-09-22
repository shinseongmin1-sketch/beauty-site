// 직원 권한 공격 테스트 (화면 / 직접 URL / Server Action 직접 호출) — 테스트 Supabase 프로젝트 전용.
//   npm run dev:test  (http://localhost:3100)  →  node tests/e2e/staff-attack.mjs [--headless]
//
// ① 화면: 직원 계정에 금지된 버튼·메뉴가 렌더링되지 않는지
// ② 직접 URL: 금지된 주소를 주소창에 입력하면 대시보드로 돌려보내는지
// ③ Server Action 직접 호출: 대표 화면에서 실제 요청(Next-Action)을 캡처한 뒤, 직원/관리자 세션 쿠키로 그대로 재전송.
//    (대조군: 같은 재전송을 대표 세션으로 하면 실제로 실행된다 → 재전송 방식 자체가 유효하다는 증명)
// ④ DB/RLS: tests/integration/role-based-access.test.mjs (JWT 로 PostgREST 직접 호출) 에서 검증
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
const created = [];
async function mkUser(label, name) {
  const email = `atk-${run}-${label}@gmail.com`;
  const u = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: name } });
  created.push(u.id);
  return { id: u.id, email, name };
}
const rpcCreateBiz = async (user, name) => {
  const l = await (await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, password: PW }) })).json();
  return (await (await fetch(`${t.url}/rest/v1/rpc/create_my_business`, { method: "POST", headers: { apikey: t.anonKey, Authorization: `Bearer ${l.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_name: name, p_business_number_hash: crypto.randomBytes(32).toString("hex") }) })).json());
};

// ── 결과 기록 ─────────────────────────────────────────────────────────
const rows = [];
const record = (layer, name, ok, note = "") => {
  rows.push({ layer, name, ok, note });
  console.log(`  ${ok ? "✔" : "✖"} [${layer}] ${name}${note ? `  — ${note}` : ""}`);
};
async function check(layer, name, fn) {
  try { const note = await fn(); record(layer, name, true, note ?? ""); } catch (e) { record(layer, name, false, e.message.split("\n")[0]); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };

// ── 브라우저/세션 ─────────────────────────────────────────────────────
const browser = await chromium.launch({ channel: "msedge", headless: Boolean(args.headless), slowMo: args.headless ? 0 : 120 });
async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", user.email);
  await page.fill("input[name=password]", PW);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard/);
  return { ctx, page, user };
}

// Server Action 요청 캡처 / 재전송
async function capture(page, trigger) {
  const got = [];
  const h = (req) => { if (req.method() === "POST" && req.headers()["next-action"]) got.push({ url: req.url(), headers: req.headers(), body: req.postDataBuffer() }); };
  page.on("request", h);
  await trigger();
  await page.waitForTimeout(2000);
  page.off("request", h);
  if (got.length === 0) { await page.screenshot({ path: path.join(shotDir, "atk-capture-fail.png"), fullPage: true }).catch(() => {}); console.log("    [debug] 캡처 실패 URL:", page.url()); }
  expect(got.length > 0, "Server Action 요청을 캡처하지 못함");
  return got[0];
}
async function replay(sess, cap, swaps = []) {
  let body = cap.body ? cap.body.toString("utf8") : "";
  for (const [from, to] of swaps) body = body.split(from).join(to);
  const headers = {};
  for (const k of ["content-type", "next-action", "next-router-state-tree", "accept"]) if (cap.headers[k]) headers[k] = cap.headers[k];
  const res = await sess.ctx.request.post(cap.url, { headers, data: Buffer.from(body, "utf8"), maxRedirects: 0, failOnStatusCode: false });
  return res.status();
}

console.log(`\n▶ 대상: ${BASE} → 테스트 Supabase(${t.ref})\n`);

// ── 셋업 ──────────────────────────────────────────────────────────────
try {
const uO = await mkUser("owner", "대표");
const uM = await mkUser("manager", "관리자");
const uS = await mkUser("staff", "직원");
const uY = await mkUser("yowner", "Y대표");
const bizA = await rpcCreateBiz(uO, `공격시험-A-${run}`);
const bizY = await rpcCreateBiz(uY, `공격시험-Y-${run}`);
await svc("PATCH", `profiles?id=eq.${uM.id}`, { business_id: bizA, role: "manager" });
await svc("PATCH", `profiles?id=eq.${uS.id}`, { business_id: bizA, role: "staff" });
const stM = (await svc("POST", "staff", { business_id: bizA, profile_id: uM.id, name: "관리자", role: "manager" }))[0].id;
const stS = (await svc("POST", "staff", { business_id: bizA, profile_id: uS.id, name: "직원", role: "staff" }))[0].id;
const mkLabel = async (n) => (await svc("POST", "staff", { business_id: bizA, name: n, role: "staff" }))[0].id;
const mkCust = async (b, n) => (await svc("POST", "customers", { business_id: b, name: n, phone: "010-1234-5678" }))[0].id;
const start = new Date(Date.now() + 86_400_000).toISOString(), end = new Date(Date.now() + 90_000_000).toISOString();
const mkRes = async (b, c) => (await svc("POST", "reservations", { business_id: b, customer_id: c, start_time: start, end_time: end, status: "confirmed", content: "시험예약" }))[0].id;
const custY = await mkCust(bizY, "Y고객-비밀");
const resY = await mkRes(bizY, custY);
await svc("POST", "payments", { business_id: bizY, gross_amount: 999000, amount: 999000, status: "paid", memo: "Y매출" });
const exists = async (tbl, id) => (await svc("GET", `${tbl}?id=eq.${id}&select=id`)).length === 1;
const count = async (tbl, q) => (await svc("GET", `${tbl}?${q}&select=id`)).length;

const O = await session(uO), M = await session(uM), S = await session(uS);

// ══ ① 화면: 직원 계정에 금지된 UI 가 없는지 ══════════════════════════
const custV = await mkCust(bizA, "화면점검고객");
const resV = await mkRes(bizA, custV);
await svc("POST", "payments", { business_id: bizA, customer_id: custV, gross_amount: 12345, amount: 12345, status: "paid" });
await S.page.goto(`${BASE}/dashboard`);
await S.page.waitForLoadState("networkidle").catch(() => {});
const homeText = await S.page.locator("body").innerText();
await check("① 화면", "직원 사이드 메뉴에 매출/마케팅/설정/담당자/시술·메뉴/예약그룹·타입 없음", async () => {
  for (const label of ["매출관리", "마케팅", "설정", "담당자", "시술/메뉴", "예약그룹", "예약타입", "재방문 관리"]) {
    expect(!homeText.includes(label), `'${label}' 메뉴가 보임`);
  }
});
await check("① 화면", "직원 대시보드에 '오늘 예상매출' 카드 없음", async () => { expect(!homeText.includes("오늘 예상매출") && !homeText.includes("매출 확인"), "매출 관련 요소가 보임"); });
await S.page.goto(`${BASE}/dashboard/customers/${custV}`);
await S.page.waitForLoadState("networkidle").catch(() => {});
const custText = await S.page.locator("body").innerText();
await check("① 화면", "직원 고객 상세: 고객 삭제 / 매출등록 / 문자보내기 / 매출이력 / 총 결제금액 없음", async () => {
  for (const label of ["고객 삭제", "+ 매출등록", "문자보내기", "매출이력", "총 결제금액", "12,345"]) expect(!custText.includes(label), `'${label}' 이 보임`);
});
await S.page.goto(`${BASE}/dashboard/reservations/${resV}`);
await S.page.waitForLoadState("networkidle").catch(() => {});
const resText = await S.page.locator("body").innerText();
await check("① 화면", "직원 예약 상세: 예약 삭제 / 결제 영역 없음 (상태변경·수정은 가능)", async () => {
  expect(!resText.includes("예약 삭제") && !resText.includes("결제 요청하기") && !resText.includes("결제완료"), "삭제/결제 요소가 보임");
  expect(resText.includes("상태 변경"), "상태 변경 영역이 없음(정상 기능이 사라짐)");
});
await S.page.goto(`${BASE}/dashboard/reservations`);
await S.page.waitForLoadState("networkidle").catch(() => {});
await check("① 화면", "직원 예약 화면: 예약그룹/예약타입 추가·수정 버튼 없음 (예약 등록 버튼은 있음)", async () => {
  expect((await S.page.locator('[aria-label="예약그룹 추가"], [aria-label="예약타입 추가"]').count()) === 0, "분류 추가 버튼이 보임");
  expect((await S.page.locator("button:has-text('예약 등록')").count()) > 0, "예약 등록 버튼이 사라짐");
});
await S.page.goto(`${BASE}/dashboard/consultations`);
await S.page.waitForLoadState("networkidle").catch(() => {});
await check("① 화면", "직원 상담 화면: 상담유형 추가 버튼 없음", async () => { expect((await S.page.locator('[aria-label="상담유형 추가"]').count()) === 0, "상담유형 추가 버튼이 보임"); });
await S.page.screenshot({ path: path.join(shotDir, "atk-1-staff-consultations.png"), fullPage: true });

// ══ ② 직접 URL ═══════════════════════════════════════════════════════
const blockedUrls = ["/dashboard/sales", "/dashboard/sales/new", "/dashboard/sales/history", "/dashboard/sales/methods", "/dashboard/marketing", "/dashboard/settings", "/dashboard/settings/notifications", "/dashboard/settings/items", "/dashboard/staff", "/dashboard/customers/revisit", "/dashboard/services", "/dashboard/reservations/groups", "/dashboard/reservations/types", "/dashboard/consultations/types", "/dashboard/customers/grades", "/dashboard/customers/tags", `/dashboard/reservations/${resV}/pay`, "/payments/success?paymentKey=x&orderId=y&amount=1"];
await check("② 직접 URL", `직원이 금지 주소 ${blockedUrls.length}개를 직접 입력 → 모두 대시보드로 되돌려짐`, async () => {
  const leaks = [];
  for (const u of blockedUrls) {
    await S.page.goto(`${BASE}${u}`);
    await S.page.waitForLoadState("networkidle").catch(() => {});
    const p = new URL(S.page.url()).pathname;
    if (p !== "/dashboard") leaks.push(`${u} → ${p}`);
  }
  expect(leaks.length === 0, leaks.join(", "));
  return `${blockedUrls.length}개 차단`;
});
await check("② 직접 URL", "관리자가 대표 전용 주소(마케팅/설정/알림설정/항목관리) 직접 입력 → 차단", async () => {
  const leaks = [];
  for (const u of ["/dashboard/marketing", "/dashboard/settings", "/dashboard/settings/notifications", "/dashboard/settings/items"]) {
    await M.page.goto(`${BASE}${u}`);
    await M.page.waitForLoadState("networkidle").catch(() => {});
    if (new URL(M.page.url()).pathname !== "/dashboard") leaks.push(u);
  }
  expect(leaks.length === 0, `접근 가능: ${leaks.join(", ")}`);
});
await check("② 직접 URL", "직원이 다른 사업장(Y) 고객/예약 URL 직접 입력 → 정보 미표시(404)", async () => {
  for (const u of [`/dashboard/customers/${custY}`, `/dashboard/reservations/${resY}`]) {
    await S.page.goto(`${BASE}${u}`);
    await S.page.waitForLoadState("networkidle").catch(() => {});
    const text = await S.page.locator("body").innerText();
    expect(!text.includes("Y고객-비밀") && !text.includes("시험예약"), `${u} 에 Y 정보가 보임`);
  }
});
await check("② 직접 URL", "직원 정상 접근: 고객/예약/상담/일정/예약고객검색/고객이력 페이지는 열림", async () => {
  for (const u of ["/dashboard/customers", "/dashboard/reservations", "/dashboard/consultations", "/dashboard/consultations/new", "/dashboard/schedule", "/dashboard/reservations/search", "/dashboard/customers/history"]) {
    await S.page.goto(`${BASE}${u}`);
    await S.page.waitForLoadState("networkidle").catch(() => {});
    expect(new URL(S.page.url()).pathname === u, `${u} 접근 불가 → ${S.page.url()}`);
  }
});

// ══ ③ Server Action 직접 호출 (대표 화면에서 캡처 → 직원/관리자 세션으로 재전송) ═
const fill = (page, sel, v) => page.locator(sel).first().fill(v);
const card = (page, text) => page.locator("div").filter({ hasText: text }).filter({ has: page.locator("button", { hasText: /^수정$/ }) }).last();

// 3-1. 고객 삭제 / 예약 삭제
{
  const [c1, c2, c3] = [await mkCust(bizA, "삭제캡처"), await mkCust(bizA, "삭제피해자"), await mkCust(bizA, "삭제대조군")];
  const cap = await capture(O.page, async () => { await O.page.goto(`${BASE}/dashboard/customers/${c1}`); await O.page.locator("button", { hasText: "고객 삭제" }).click(); });
  const st = await replay(S, cap, [[c1, c2]]);
  await check("③ Server Action", "직원 → 고객 삭제 액션 재전송 → 차단", async () => { expect(await exists("customers", c2), "직원이 고객을 삭제함"); return `HTTP ${st}, 고객 그대로`; });
  await replay(O, cap, [[c1, c3]]);
  await check("③ Server Action", "(대조군) 대표가 같은 재전송 → 실제로 삭제됨", async () => { expect(!(await exists("customers", c3)), "대표 재전송이 동작하지 않음 → 이 테스트 방식이 무효"); });

  const [r1, r2, r3] = [await mkRes(bizA, c2), await mkRes(bizA, c2), await mkRes(bizA, c2)];
  const cap2 = await capture(O.page, async () => { await O.page.goto(`${BASE}/dashboard/reservations/${r1}`); await O.page.locator("button", { hasText: "예약 삭제" }).click(); });
  const st2 = await replay(S, cap2, [[r1, r2]]);
  await check("③ Server Action", "직원 → 예약 삭제 액션 재전송 → 차단", async () => { expect(await exists("reservations", r2), "직원이 예약을 삭제함"); return `HTTP ${st2}, 예약 그대로`; });
  await replay(O, cap2, [[r1, r3]]);
  await check("③ Server Action", "(대조군) 대표가 같은 재전송 → 실제로 삭제됨", async () => { expect(!(await exists("reservations", r3)), "대표 재전송이 동작하지 않음"); });
}

// 3-2. 담당자 삭제
{
  const [l1, l2, l3] = [await mkLabel("삭제캡처"), await mkLabel("삭제피해자"), await mkLabel("삭제대조군")];
  O.page.once("dialog", (d) => d.accept());
  const cap = await capture(O.page, async () => { await O.page.goto(`${BASE}/dashboard/staff`); await O.page.locator("tr", { hasText: "삭제캡처" }).locator("button", { hasText: "삭제" }).click(); });
  for (const [who, sess] of [["직원", S]]) {
    const st = await replay(sess, cap, [[l1, l2]]);
    await check("③ Server Action", `${who} → 담당자 삭제 액션 재전송 → 차단`, async () => { expect(await exists("staff", l2), `${who}이 담당자를 삭제함`); return `HTTP ${st}`; });
  }
  await replay(O, cap, [[l1, l3]]);
  await check("③ Server Action", "(대조군) 대표가 같은 재전송 → 실제로 삭제됨", async () => { expect(!(await exists("staff", l3)), "대표 재전송이 동작하지 않음"); });
}

// 3-3. 결제수단 추가 / 수정 / 삭제
{
  const mk = async (n) => (await svc("POST", "payment_methods", { business_id: bizA, name: n }))[0].id;
  const [mUpd, mDel, vUpd, vDel, cDel] = [await mk("수정캡처"), await mk("삭제캡처"), await mk("수정피해자"), await mk("삭제피해자"), await mk("삭제대조군")];
  await O.page.goto(`${BASE}/dashboard/sales/methods`);
  const capAdd = await capture(O.page, async () => {
    await O.page.getByRole("button", { name: /추가/ }).first().click();
    await O.page.locator("input[name=name]").fill("결제수단추가캡처");
    await O.page.getByRole("button", { name: "저장" }).click();
  });
  if (args.debug) console.log("    [debug] add body:", capAdd.body?.toString("utf8").slice(0, 400), capAdd.url, Object.keys(capAdd.headers).join(","));
  const s0 = await replay(O, capAdd, [["결제수단추가캡처", "대표가만듦"]]);
  await check("③ Server Action", "(대조군) 대표가 결제수단 추가 액션 재전송 → 실제로 추가됨", async () => { expect((await count("payment_methods", `business_id=eq.${bizA}&name=eq.${encodeURIComponent("대표가만듦")}`)) === 1, `대표 재전송이 동작하지 않음 (HTTP ${s0})`); });
  const s1 = await replay(S, capAdd, [["결제수단추가캡처", "직원이만듦"]]);
  const s1m = await replay(M, capAdd, [["결제수단추가캡처", "관리자가만듦"]]);
  await check("③ Server Action", "직원 → 결제수단 추가 액션 재전송 → 차단", async () => { expect((await count("payment_methods", `business_id=eq.${bizA}&name=eq.${encodeURIComponent("직원이만듦")}`)) === 0, "직원이 결제수단을 추가함"); return `HTTP ${s1}`; });
  await check("③ Server Action", "(대조군) 관리자는 결제수단 추가 가능 (정상 권한)", async () => { expect((await count("payment_methods", `business_id=eq.${bizA}&name=eq.${encodeURIComponent("관리자가만듦")}`)) === 1, `관리자 재전송이 동작하지 않음/권한 과차단 (HTTP ${s1m})`); });

  await O.page.goto(`${BASE}/dashboard/sales/methods`);
  const capUpd = await capture(O.page, async () => {
    await card(O.page, "수정캡처").locator("button", { hasText: /^수정$/ }).click();
    await O.page.locator("input[name=name]").fill("수정캡처-변경됨");
    await O.page.getByRole("button", { name: "저장" }).click();
  });
  const s2 = await replay(S, capUpd, [[mUpd, vUpd], ["수정캡처-변경됨", "직원이바꿈"]]);
  await check("③ Server Action", "직원 → 결제수단 수정 액션 재전송 → 차단", async () => { expect((await svc("GET", `payment_methods?id=eq.${vUpd}&select=name`))[0].name === "수정피해자", "직원이 결제수단을 수정함"); return `HTTP ${s2}`; });

  O.page.once("dialog", (d) => d.accept());
  await O.page.goto(`${BASE}/dashboard/sales/methods`);
  const capDel = await capture(O.page, async () => { await card(O.page, "삭제캡처").locator("button", { hasText: /^삭제$/ }).click(); });
  const s3 = await replay(S, capDel, [[mDel, vDel]]);
  await check("③ Server Action", "직원 → 결제수단 삭제 액션 재전송 → 차단", async () => { expect(await exists("payment_methods", vDel), "직원이 결제수단을 삭제함"); return `HTTP ${s3}`; });
  await replay(O, capDel, [[mDel, cDel]]);
  await check("③ Server Action", "(대조군) 대표가 같은 재전송 → 실제로 삭제됨", async () => { expect(!(await exists("payment_methods", cDel)), "대표 재전송이 동작하지 않음"); });
}

// 3-4. 알림 설정 변경
{
  await O.page.goto(`${BASE}/dashboard/settings/notifications`);
  const cap = await capture(O.page, async () => { await O.page.locator("input[name=channel][value=kakao]").check(); await O.page.locator("form button[type=submit]").last().click(); });
  await svc("PATCH", `notification_settings?business_id=eq.${bizA}`, { channel: "sms" });
  const ch = async () => (await svc("GET", `notification_settings?business_id=eq.${bizA}&select=channel`))[0].channel;
  const sS = await replay(S, cap), sM = await replay(M, cap);
  await check("③ Server Action", "직원 → 알림 설정 변경 액션 재전송 → 차단", async () => { expect((await ch()) === "sms", "직원이 알림 설정을 바꿈"); return `HTTP ${sS}`; });
  await check("③ Server Action", "관리자 → 알림 설정 변경 액션 재전송 → 차단 (대표 전용)", async () => { expect((await ch()) === "sms", "관리자가 알림 설정을 바꿈"); return `HTTP ${sM}`; });
  await replay(O, cap);
  await check("③ Server Action", "(대조군) 대표가 같은 재전송 → 실제로 변경됨", async () => { expect((await ch()) === "kakao", "대표 재전송이 동작하지 않음"); });
}

// 3-5. 마케팅 발송 기록 생성
{
  await O.page.goto(`${BASE}/dashboard/marketing`);
  const cap = await capture(O.page, async () => {
    await O.page.locator("input[name=target_description]").fill("공격시험 대상");
    await O.page.locator("textarea[name=message]").fill("공격시험 메시지");
    await O.page.locator("form button[type=submit]").last().click();
  });
  const n = () => count("marketing_messages", `business_id=eq.${bizA}&message=eq.${encodeURIComponent("공격시험 메시지")}`);
  const base = await n();
  const sS = await replay(S, cap), sM = await replay(M, cap);
  await check("③ Server Action", "직원 → 마케팅 발송 기록 생성 액션 재전송 → 차단", async () => { expect((await n()) === base, "직원이 마케팅 기록을 만듦"); return `HTTP ${sS}`; });
  await check("③ Server Action", "관리자 → 마케팅 발송 기록 생성 액션 재전송 → 차단 (대표 전용)", async () => { expect((await n()) === base, "관리자가 마케팅 기록을 만듦"); return `HTTP ${sM}`; });
  await replay(O, cap);
  await check("③ Server Action", "(대조군) 대표가 같은 재전송 → 실제로 생성됨", async () => { expect((await n()) === base + 1, "대표 재전송이 동작하지 않음"); });
}

// 3-6. 사업장 정보 변경
{
  const nameOf = async () => (await svc("GET", `businesses?id=eq.${bizA}&select=name`))[0].name;
  const orig = await nameOf();
  await O.page.goto(`${BASE}/dashboard/settings`);
  const cap = await capture(O.page, async () => { await O.page.locator("input[name=name]").fill(`${orig}-변경시도`); await O.page.locator("form button[type=submit]").last().click(); });
  await svc("PATCH", `businesses?id=eq.${bizA}`, { name: orig });
  const sS = await replay(S, cap), sM = await replay(M, cap);
  await check("③ Server Action", "직원 → 사업장 정보 변경 액션 재전송 → 차단", async () => { expect((await nameOf()) === orig, "직원이 사업장 정보를 바꿈"); return `HTTP ${sS}`; });
  await check("③ Server Action", "관리자 → 사업장 정보 변경 액션 재전송 → 차단 (대표 전용)", async () => { expect((await nameOf()) === orig, "관리자가 사업장 정보를 바꿈"); return `HTTP ${sM}`; });
  await replay(O, cap);
  await check("③ Server Action", "(대조군) 대표가 같은 재전송 → 실제로 변경됨", async () => { expect((await nameOf()) === `${orig}-변경시도`, "대표 재전송이 동작하지 않음"); });
  await svc("PATCH", `businesses?id=eq.${bizA}`, { name: orig });
}

// 3-7. 매출 등록
{
  await svc("POST", "customers", { business_id: bizA, name: "매출고객", phone: "010-7777-7777" });
  await O.page.goto(`${BASE}/dashboard/sales/new`);
  const cap = await capture(O.page, async () => {
    await O.page.locator("input[placeholder='고객명 또는 휴대폰 번호 검색']").fill("매출고객");
    await O.page.locator("button:has-text('매출고객')").first().click();
    await O.page.locator("input[name=gross_amount]").fill("31000");
    await O.page.locator("input[name=paid_at]").fill(new Date().toISOString().slice(0, 10));
    await O.page.locator("form button[type=submit]").last().click();
  });
  const n = () => count("payments", `business_id=eq.${bizA}&gross_amount=eq.31000`);
  const base = await n();
  const sS = await replay(S, cap);
  await check("③ Server Action", "직원 → 매출 등록 액션 재전송 → 차단", async () => { expect((await n()) === base, "직원이 매출을 등록함"); return `HTTP ${sS}`; });
  await replay(M, cap);
  await check("③ Server Action", "(대조군) 관리자는 매출 등록 가능 (정상 권한)", async () => { expect((await n()) === base + 1, "관리자 재전송이 동작하지 않음/권한 과차단"); });
}

// 3-8. 시술/메뉴 추가 (분류 관리)
{
  await O.page.goto(`${BASE}/dashboard/services`);
  const cap = await capture(O.page, async () => {
    await fill(O.page, "input[name=name][placeholder='메뉴 이름']", "공격시험메뉴");
    await O.page.locator("form:has(input[name=duration_minutes]) button[type=submit]").first().click();
  });
  const n = () => count("services", `business_id=eq.${bizA}&name=eq.${encodeURIComponent("공격시험메뉴")}`);
  const base = await n();
  const sS = await replay(S, cap);
  await check("③ Server Action", "직원 → 시술/메뉴 추가 액션 재전송 → 차단", async () => { expect((await n()) === base, "직원이 시술/메뉴를 추가함"); return `HTTP ${sS}`; });
  await replay(O, cap);
  await check("③ Server Action", "(대조군) 대표가 같은 재전송 → 실제로 추가됨", async () => { expect((await n()) === base + 1, "대표 재전송이 동작하지 않음"); });
}

// 3-9. 권한 상승 (직원이 자기/타인 직급 변경)
{
  const lb = await mkLabel("직급캡처");
  await O.page.goto(`${BASE}/dashboard/staff`);
  const cap = await capture(O.page, async () => {
    await O.page.locator("tr", { hasText: "직급캡처" }).locator("button", { hasText: "수정" }).click();
    await O.page.locator("form:has(select[name=role]) select[name=role]").last().selectOption("manager");
    await O.page.locator("form:has(select[name=role]) button[type=submit]").last().click();
  });
  const roleOf = async (id) => (await svc("GET", `profiles?id=eq.${id}&select=role`))[0].role;
  const staffRole = async (id) => (await svc("GET", `staff?id=eq.${id}&select=role`))[0].role;
  await replay(S, cap, [[lb, stS]]);
  await check("③ Server Action", "직원 → 직급 변경(자기를 관리자로 승격) 액션 재전송 → 차단", async () => {
    expect((await roleOf(uS.id)) === "staff" && (await staffRole(stS)) === "staff", "직원이 자기 직급을 올림");
  });
  await replay(M, cap, [[lb, stS]]);
  await check("③ Server Action", "관리자 → 직원 직급 변경 액션 재전송 → 차단 (직급 변경은 대표 전용)", async () => {
    expect((await roleOf(uS.id)) === "staff" && (await staffRole(stS)) === "staff", "관리자가 직급을 바꿈");
  });
  await replay(M, cap, [[lb, stM]]);
  await check("③ Server Action", "관리자 → 자기 직급 변경 시도 → 차단", async () => { expect((await roleOf(uM.id)) === "manager", "관리자 직급이 바뀜"); });
  await replay(O, cap, [[lb, stS]]);
  await check("③ Server Action", "(대조군) 대표가 같은 재전송 → 직급 변경됨 (계정 권한도 함께)", async () => {
    expect((await roleOf(uS.id)) === "manager" && (await staffRole(stS)) === "manager", "대표 재전송이 동작하지 않음");
  });
  await svc("PATCH", `profiles?id=eq.${uS.id}`, { role: "staff" });
  await svc("PATCH", `staff?id=eq.${stS}`, { role: "staff" });
}

// 3-10. 다른 사업장(Y) 대상 액션 재전송
{
  const cap = await capture(O.page, async () => { const c = await mkCust(bizA, "타사업장캡처"); await O.page.goto(`${BASE}/dashboard/customers/${c}`); await O.page.locator("button", { hasText: "고객 삭제" }).click(); });
  const id = cap.body.toString("utf8").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  await replay(O, cap, [[id, custY]]);
  await check("③ Server Action", "대표(A) → 다른 사업장(Y) 고객 삭제 액션 재전송 → 차단 (사업장 격리)", async () => { expect(await exists("customers", custY), "A 대표가 Y 고객을 삭제함"); });
}


// ══ ④ 정상 기능: 직원이 화면에서 고객/예약/상담을 실제로 등록·수정할 수 있어야 한다 ══
{
  const ymd = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  await svc("POST", "services", { business_id: bizA, name: "직원시험메뉴", duration_minutes: 30, price: 10000 });
  let staffCust, staffRes;
  await check("④ 정상 기능", "직원: 고객 등록 + 메모 수정 (화면)", async () => {
    await S.page.goto(`${BASE}/dashboard/customers`);
    const f = S.page.locator("form:has(input[name=name][placeholder='이름'])").first();
    await f.locator("input[name=name]").fill("직원이등록한고객");
    await f.locator("input[name=phone]").fill("010-4444-5555");
    await f.locator("button[type=submit]").click();
    await S.page.waitForSelector("text=직원이등록한고객");
    staffCust = (await svc("GET", `customers?business_id=eq.${bizA}&name=eq.${encodeURIComponent("직원이등록한고객")}&select=id`))[0].id;
    await S.page.goto(`${BASE}/dashboard/customers/${staffCust}`);
    await S.page.locator("button", { hasText: /^메모$/ }).click();
    const memoForm = S.page.locator("form:has(textarea[name=memo])").last();
    await memoForm.locator("[name=memo]").fill("직원이 수정한 메모");
    await memoForm.locator("button[type=submit]").click();
    await S.page.waitForTimeout(1200);
    expect((await svc("GET", `customers?id=eq.${staffCust}&select=memo`))[0].memo === "직원이 수정한 메모", "메모가 저장되지 않음");
  });
  await check("④ 정상 기능", "직원: 예약 등록 + 수정 + 상태 변경 (화면)", async () => {
    await S.page.goto(`${BASE}/dashboard/reservations?new=1`);
    const modal = S.page.locator("form:has(input[name=start_time])").first();
    await modal.locator("input[placeholder='고객명 또는 휴대폰 번호 검색']").fill("직원이등록");
    await S.page.locator("button:has-text('직원이등록한고객')").first().click();
    await modal.locator("input[name=start_time]").fill("11:00");
    const opts = await modal.locator("select[name=service_id] option").allInnerTexts();
    await modal.locator("select[name=service_id]").selectOption({ index: opts.findIndex((o) => o.includes("직원시험메뉴")) });
    await modal.locator("[name=content]").fill("직원이 만든 예약");
    await modal.locator("button[type=submit]").click();
    await S.page.waitForTimeout(1500);
    const r = (await svc("GET", `reservations?business_id=eq.${bizA}&customer_id=eq.${staffCust}&select=id,content`))[0];
    expect(r?.content === "직원이 만든 예약", "예약이 저장되지 않음");
    staffRes = r.id;
    await S.page.goto(`${BASE}/dashboard/reservations?date=${ymd}&edit=${staffRes}`);
    const form = S.page.locator("form:has(input[name=start_time])").last();
    await form.locator("input[name=start_time]").fill("12:00");
    await form.locator("input[name=end_time]").fill("12:30");
    await form.locator("[name=content]").fill("직원이 수정한 예약");
    await form.locator("button[type=submit]").click();
    await S.page.waitForTimeout(1500);
    expect((await svc("GET", `reservations?id=eq.${staffRes}&select=content`))[0].content === "직원이 수정한 예약", "예약 수정이 저장되지 않음");
    await S.page.goto(`${BASE}/dashboard/reservations/${staffRes}`);
    await S.page.locator("button", { hasText: /^완료$/ }).click();
    await S.page.waitForTimeout(1200);
    expect((await svc("GET", `reservations?id=eq.${staffRes}&select=status`))[0].status === "completed", "상태 변경이 저장되지 않음");
  });
  await check("④ 정상 기능", "직원: 상담 등록 + 결과 변경 (화면)", async () => {
    await S.page.goto(`${BASE}/dashboard/consultations/new`);
    await S.page.locator("input[placeholder='고객명 또는 휴대폰 번호 검색']").fill("직원이등록");
    await S.page.locator("button:has-text('직원이등록한고객')").first().click();
    await S.page.locator("input[name=consult_date]").fill(ymd);
    await S.page.locator("textarea[name=content]").fill("직원이 남긴 상담");
    await S.page.locator("form button[type=submit]").last().click();
    await S.page.waitForURL((u) => u.pathname === "/dashboard/consultations");
    const c = (await svc("GET", `consultations?business_id=eq.${bizA}&customer_id=eq.${staffCust}&select=id,content`))[0];
    expect(c?.content === "직원이 남긴 상담", "상담이 저장되지 않음");
    await S.page.locator("tr", { hasText: "직원이등록한고객" }).locator("select").first().selectOption("상담완료");
    await S.page.waitForTimeout(1200);
    expect((await svc("GET", `consultations?id=eq.${c.id}&select=result`))[0].result === "상담완료", "상담 결과 변경이 저장되지 않음");
  });
  await check("④ 정상 기능", "직원: 예약 화면의 예약그룹·타입·담당자·시술 선택 목록이 정상 표시 (읽기 권한)", async () => {
    await S.page.goto(`${BASE}/dashboard/reservations?new=1`);
    const modal = S.page.locator("form:has(input[name=start_time])").first();
    await modal.locator("input[name=start_time]").waitFor();
    const svcOpts = await modal.locator("select[name=service_id] option").allInnerTexts();
    expect(svcOpts.some((o) => o.includes("직원시험메뉴")), "시술 목록이 비어 있음");
    expect((await modal.locator("select[name=staff_id] option").count()) > 1, "담당자 목록이 비어 있음");
  });
}

} catch (e) {
  record("실행", "테스트 스크립트 오류", false, e.message.split(String.fromCharCode(10))[0]);
} finally {
  await browser.close();
  for (const id of created) await fetch(`${t.url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: SH }).catch(() => {});
}

const failed = rows.filter((r) => !r.ok);
const by = (l) => rows.filter((r) => r.layer.startsWith(l));
console.log(`\n결과: ${rows.length - failed.length}/${rows.length} 통과 (① 화면 ${by("①").filter((r) => r.ok).length}/${by("①").length} · ② URL ${by("②").filter((r) => r.ok).length}/${by("②").length} · ③ Server Action ${by("③").filter((r) => r.ok).length}/${by("③").length})`);
if (failed.length) { console.log("\n실패:"); for (const f of failed) console.log(`  [${f.layer}] ${f.name}: ${f.note}`); }
process.exit(failed.length ? 1 : 0);

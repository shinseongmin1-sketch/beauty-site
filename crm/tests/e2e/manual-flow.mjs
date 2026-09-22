// 화면 수동 검증 자동화 — 실제 Edge 브라우저를 띄워 "테스트 Supabase 프로젝트"에 연결된 개발 서버를 조작한다.
//   1) npm run dev:test          (다른 터미널에서 먼저 실행: http://localhost:3100)
//   2) node tests/e2e/manual-flow.mjs [--headless] [--keep]
// 운영 DB 에는 연결하지 않는다 (loadTarget("test") 가 운영 URL 이면 중단).
// 스크린샷: crm/.e2e-shots/  (Git 무시)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { loadTarget, parseArgs, root } from "../../scripts/lib/env.mjs";

const args = parseArgs();
const t = loadTarget("test");
const BASE = args.base ?? "http://localhost:3100";
const run = crypto.randomBytes(3).toString("hex");
const PASSWORD = `Pw-${crypto.randomBytes(8).toString("base64url")}`;
const shotDir = path.join(root, ".e2e-shots");
fs.mkdirSync(shotDir, { recursive: true });

const svcH = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };
const svc = async (method, pq, body) => {
  const r = await fetch(`${t.url}/rest/v1/${pq}`, { method, headers: { ...svcH, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`svc ${method} ${pq}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
};
const adminUser = async (method, p, body) => {
  const r = await fetch(`${t.url}/auth/v1/admin/users${p}`, { method, headers: svcH, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`auth admin ${method} ${p}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};
const userIdByEmail = async (email) => {
  const list = await adminUser("GET", "?per_page=200");
  return list.users.find((u) => u.email === email)?.id;
};

const results = [];
let n = 0;
async function step(label, page, fn) {
  n++;
  const id = String(n).padStart(2, "0");
  try {
    const note = await fn();
    results.push({ id, label, ok: true, note: note ?? "" });
    console.log(`  ✔ ${id} ${label}${note ? `  — ${note}` : ""}`);
  } catch (e) {
    results.push({ id, label, ok: false, note: e.message.split("\n")[0] });
    console.log(`  ✖ ${id} ${label}  — ${e.message.split("\n")[0]}`);
  }
  if (page) await page.screenshot({ path: path.join(shotDir, `${id}-${label.replace(/[^\w가-힣]+/g, "_").slice(0, 40)}.png`), fullPage: true }).catch(() => {});
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const bodyText = (page) => page.locator("body").innerText();

const browser = await chromium.launch({ channel: "msedge", headless: Boolean(args.headless), slowMo: args.headless ? 0 : 250 });
const mk = async () => { const c = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const p = await c.newPage(); p.setDefaultTimeout(15000); return p; };
const [pA, pS, pB] = [await mk(), await mk(), await mk()];

const A = { email: `e2e-a-${run}@gmail.com`, name: "A대표", biz: `A매장-${run}` };
const B = { email: `e2e-b-${run}@gmail.com`, name: "B대표", biz: `B매장-${run}` };
const S = { email: `e2e-s-${run}@gmail.com`, name: "직원계정" };
const ids = {};

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', PASSWORD);
  await page.click('button[type=submit]');
}
async function signupAndOnboard(page, acct, label) {
  await page.goto(`${BASE}/signup`);
  await page.fill('input[name=full_name]', acct.name);
  await page.fill('input[name=email]', acct.email);
  await page.fill('input[name=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(onboarding|login)/);
  let note = "가입 즉시 로그인";
  if (page.url().includes("/login")) {
    // 테스트 프로젝트가 이메일 확인을 요구하는 경우: 메일 클릭을 관리자 API 로 대신한다
    note = "이메일 확인 필요 화면 → 관리자 API 로 확인 처리 후 로그인";
    const id = await userIdByEmail(acct.email);
    await adminUser("PUT", `/${id}`, { email_confirm: true });
    await login(page, acct.email);
    await page.waitForURL(/\/onboarding/);
  }
  await page.fill('input[name=name]', acct.biz);
  await page.fill('input[name=representative_name]', acct.name);
  await page.fill('input[name=business_number]', String(Math.floor(1e9 + Math.random() * 9e9)));
  await page.fill('input[name=phone]', `02-${Math.floor(1e7 + Math.random() * 9e7)}`);
  await page.fill('input[name=address]', `서울 ${label}구`);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/dashboard/);
  return note;
}

console.log(`\n▶ 대상: ${BASE} → 테스트 Supabase(${t.ref})\n`);

// ── 1~3. 회원가입 / 온보딩 / 매장 생성 / 로그인 ─────────────────────────
await step("1+3 회원가입 → 온보딩(매장 생성) [A]", pA, async () => {
  const note = await signupAndOnboard(pA, A, "A");
  expect((await bodyText(pA)).includes(A.biz), "대시보드에 매장 이름이 없음");
  const [p] = await svc("GET", `profiles?id=eq.${await userIdByEmail(A.email)}&select=role,business_id`);
  expect(p.role === "owner" && p.business_id, "profiles 가 owner/매장 연결 상태가 아님");
  ids.bizA = p.business_id;
  return note;
});

await step("2 로그아웃 후 재로그인 [A]", pA, async () => {
  await pA.click("text=로그아웃");
  await pA.waitForURL(/\/login/);
  await login(pA, A.email);
  await pA.waitForURL(/\/dashboard/);
  // 잘못된 비밀번호는 실패해야 한다
  const p2 = await pS;
  await p2.goto(`${BASE}/login`);
  await p2.fill('input[name=email]', A.email);
  await p2.fill('input[name=password]', "wrong-password");
  await p2.click('button[type=submit]');
  await p2.waitForURL(/error=/);
  expect((await bodyText(p2)).includes("올바르지 않"), "잘못된 비밀번호 안내가 없음");
  return "정상 로그인 + 잘못된 비밀번호 거부";
});

// ── 4. 직원 등록 ────────────────────────────────────────────────────
await step("4 직원(담당자) 등록 [A]", pA, async () => {
  await pA.goto(`${BASE}/dashboard/staff`);
  const add = pA.locator("form:has(input[name=name][placeholder='이름'])").first();
  await add.locator("input[name=name]").fill("김디자이너");
  await add.locator("input[name=phone]").fill("010-1111-2222");
  await add.locator("input[name=title]").fill("실장");
  await add.locator("select[name=role]").selectOption("manager");
  await add.locator("button[type=submit]").click();
  await pA.waitForSelector("text=김디자이너");
  const [row] = await svc("GET", `staff?business_id=eq.${ids.bizA}&name=eq.김디자이너&select=id,role`);
  ids.staffRow = row.id;
  expect(row.role === "manager", `저장된 등급이 ${row.role}`);
});

// 직원 로그인 계정 연결 (앱에는 아직 "직원 초대" UI 가 없어서 service_role 로 셋업)
await step("셋업: 직원 로그인 계정 생성·연결 (앱에 초대 UI 없음 → service_role)", null, async () => {
  const u = await adminUser("POST", "", { email: S.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: S.name } });
  ids.staffUser = u.id;
  await svc("PATCH", `profiles?id=eq.${u.id}`, { business_id: ids.bizA, role: "manager" });
  await svc("PATCH", `staff?id=eq.${ids.staffRow}`, { profile_id: u.id });
});

// ── 5. 직원 권한 변경 (관리자 → 직원) ────────────────────────────────
await step("5 직원 권한 변경 manager → staff [A] + 계정 role 동기화", pA, async () => {
  await pA.goto(`${BASE}/dashboard/staff`);
  await pA.locator("tr", { hasText: "김디자이너" }).locator("button", { hasText: "수정" }).click();
  const form = pA.locator("form:has(select[name=role])").last();
  await form.locator("select[name=role]").selectOption("staff");
  await form.locator("button[type=submit]").click();
  await pA.waitForTimeout(1500);
  await pA.reload();
  const [row] = await svc("GET", `staff?id=eq.${ids.staffRow}&select=role`);
  const [prof] = await svc("GET", `profiles?id=eq.${ids.staffUser}&select=role`);
  expect(row.role === "staff", `staff.role=${row.role}`);
  expect(prof.role === "staff", `profiles.role=${prof.role} (로그인 계정 권한이 함께 바뀌어야 함)`);
});

// ── 8. 고객 등록/수정 ───────────────────────────────────────────────
await step("8 고객 등록 + 메모 수정 [A]", pA, async () => {
  await pA.goto(`${BASE}/dashboard/customers`);
  const f = pA.locator("form:has(input[name=name][placeholder='이름'])").first();
  await f.locator("input[name=name]").fill("A고객-홍길동");
  await f.locator("input[name=phone]").fill("010-3333-4444");
  await f.locator("input[name=memo]").fill("첫 방문");
  await f.locator("button[type=submit]").click();
  await pA.waitForSelector("text=A고객-홍길동");
  const [c] = await svc("GET", `customers?business_id=eq.${ids.bizA}&name=eq.A고객-홍길동&select=id`);
  ids.custA = c.id;
  await pA.goto(`${BASE}/dashboard/customers/${ids.custA}`);
  await pA.locator("button", { hasText: /^메모$/ }).click();
  const memoForm = pA.locator("form:has(textarea[name=memo]), form:has(input[name=memo])").last();
  await memoForm.locator("[name=memo]").fill("메모 수정됨");
  await memoForm.locator("button[type=submit]").click();
  await pA.waitForTimeout(1200);
  const [after] = await svc("GET", `customers?id=eq.${ids.custA}&select=memo`);
  expect(after.memo === "메모 수정됨", `memo=${after.memo}`);
  return "이름/연락처 수정 UI는 없음(메모·등급·태그만 수정 가능)";
});

// ── 7. 예약 등록/수정 ───────────────────────────────────────────────
await step("시술/메뉴 등록 [A] (예약·매출 준비)", pA, async () => {
  await pA.goto(`${BASE}/dashboard/services`);
  const f = pA.locator("form:has(input[name=name][placeholder='메뉴 이름'])").first();
  await f.locator("input[name=name]").fill("커트");
  await f.locator("input[name=duration_minutes]").fill("30");
  await f.locator("input[name=price]").fill("20000");
  await f.locator("button[type=submit]").click();
  await pA.waitForSelector("text=커트");
});

await step("7 예약 등록 [A]", pA, async () => {
  await pA.goto(`${BASE}/dashboard/reservations?new=1`);
  const modal = pA.locator("form:has(input[name=start_time])").first();
  await modal.locator("input[placeholder='고객명 또는 휴대폰 번호 검색']").fill("A고객");
  await pA.locator("button:has-text('A고객-홍길동')").first().click();
  await modal.locator("input[name=start_time]").fill("14:00");
  await modal.locator("select[name=service_id]").selectOption({ label: /커트/ }).catch(async () => {
    const opts = await modal.locator("select[name=service_id] option").allInnerTexts();
    const idx = opts.findIndex((o) => o.includes("커트"));
    await modal.locator("select[name=service_id]").selectOption({ index: idx });
  });
  await modal.locator("[name=content]").fill("남성 커트");
  await modal.locator("button[type=submit]").click();
  await pA.waitForTimeout(1500);
  const [r] = await svc("GET", `reservations?business_id=eq.${ids.bizA}&select=id,content,customer_id`);
  ids.resA = r.id;
  expect(r.content === "남성 커트" && r.customer_id === ids.custA, "예약 저장 내용 불일치");
});

await step("7 예약 수정 [A]", pA, async () => {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await pA.goto(`${BASE}/dashboard/reservations?date=${ymd}&edit=${ids.resA}`);
  const form = pA.locator("form:has(input[name=start_time])").last();
  await form.locator("input[name=start_time]").fill("15:00");
  await form.locator("input[name=end_time]").fill("15:40");
  await form.locator("[name=content]").fill("남성 커트 + 염색");
  await form.locator("button[type=submit]").click();
  await pA.waitForTimeout(1500);
  const [r] = await svc("GET", `reservations?id=eq.${ids.resA}&select=content,start_time`);
  expect(r.content === "남성 커트 + 염색", `content=${r.content}`);
});

// ── 9. 상담 ─────────────────────────────────────────────────────────
await step("9 상담 등록 + 결과 수정 [A]", pA, async () => {
  await pA.goto(`${BASE}/dashboard/consultations/new`);
  await pA.locator("input[placeholder='고객명 또는 휴대폰 번호 검색']").fill("A고객");
  await pA.locator("button:has-text('A고객-홍길동')").first().click();
  await pA.locator("input[name=consult_date]").fill(new Date().toISOString().slice(0, 10));
  await pA.locator("textarea[name=content]").fill("염색 상담");
  await pA.locator("form button[type=submit]").last().click();
  await pA.waitForURL(/\/dashboard\/consultations$/);
  const [c] = await svc("GET", `consultations?business_id=eq.${ids.bizA}&select=id,content,result`);
  ids.consultA = c.id;
  expect(c.content === "염색 상담", "상담 내용 불일치");
  // 목록에서 결과 변경 (인라인 select)
  const sel = pA.locator("tr", { hasText: "A고객-홍길동" }).locator("select").first();
  await sel.selectOption("상담완료");
  await pA.waitForTimeout(1200);
  const [after] = await svc("GET", `consultations?id=eq.${ids.consultA}&select=result`);
  expect(after.result === "상담완료", `result=${after.result}`);
  return "상담 내용 자체를 고치는 UI는 없음(결과만 변경 가능)";
});

// ── 10. 매출 ────────────────────────────────────────────────────────
await step("10 매출 등록 [A]", pA, async () => {
  await pA.goto(`${BASE}/dashboard/sales/new`);
  await pA.locator("input[placeholder='고객명 또는 휴대폰 번호 검색']").fill("A고객");
  await pA.locator("button:has-text('A고객-홍길동')").first().click();
  await pA.locator("input[name=gross_amount]").fill("50000");
  await pA.locator("input[name=discount_amount]").fill("5000");
  await pA.locator("input[name=paid_at]").fill(new Date().toISOString().slice(0, 10));
  await pA.locator("form button[type=submit]").last().click();
  await pA.waitForURL(/\/dashboard\/sales\/history/);
  const [p] = await svc("GET", `payments?business_id=eq.${ids.bizA}&select=id,amount,gross_amount,discount_amount`);
  ids.payA = p.id;
  expect(p.amount === 45000 && p.gross_amount === 50000, `amount=${p.amount}`);
  return "매출 수정 UI는 없음(등록/조회만 가능)";
});

// ── 11. 매장 설정 ───────────────────────────────────────────────────
await step("11 매장 설정 변경 [A]", pA, async () => {
  await pA.goto(`${BASE}/dashboard/settings`);
  await pA.locator("input[name=name]").fill(`${A.biz}(수정)`);
  await pA.locator("input[name=address]").fill("부산 해운대");
  await pA.locator("form button[type=submit]").last().click();
  await pA.waitForTimeout(1500);
  const [b] = await svc("GET", `businesses?id=eq.${ids.bizA}&select=name,address`);
  expect(b.name === `${A.biz}(수정)` && b.address === "부산 해운대", `name=${b.name}`);
});

// ── 6 + 12. 직원 로그인 / 접근 제한 ─────────────────────────────────
await step("6 직원 계정 로그인 [staff]", pS, async () => {
  await pS.context().clearCookies();
  await login(pS, S.email);
  await pS.waitForURL(/\/dashboard/);
  const text = await bodyText(pS);
  expect(text.includes(`${A.biz}(수정)`), "직원 화면에 소속 매장 이름이 안 보임");
  const nav = { 매출관리: text.includes("매출관리"), 마케팅: text.includes("마케팅"), 설정: /\n설정\n|\n설정$/.test(text), 담당자: text.includes("담당자") };
  return `메뉴 노출: ${JSON.stringify(nav)}`;
});

await step("12 직원이 금지된 페이지 직접 접근 → 대시보드로 돌려보내야 함", pS, async () => {
  const blocked = ["/dashboard/sales", "/dashboard/sales/new", "/dashboard/sales/history", "/dashboard/sales/methods", "/dashboard/marketing", "/dashboard/settings", "/dashboard/settings/notifications", "/dashboard/settings/items", "/dashboard/staff", "/dashboard/customers/revisit"];
  const leaks = [];
  for (const p of blocked) {
    await pS.goto(`${BASE}${p}`);
    await pS.waitForLoadState("networkidle").catch(() => {});
    const path_ = new URL(pS.url()).pathname;
    if (path_ !== "/dashboard") leaks.push(`${p} → ${path_}`);
  }
  expect(leaks.length === 0, `직원이 접근 가능: ${leaks.join(", ")}`);
  return `${blocked.length}개 경로 모두 차단`;
});

await step("12 직원이 허용된 기능(고객/예약/상담) 접근 [staff]", pS, async () => {
  for (const p of ["/dashboard/customers", "/dashboard/reservations", "/dashboard/consultations"]) {
    await pS.goto(`${BASE}${p}`);
    expect(new URL(pS.url()).pathname === p, `${p} 접근 불가: ${pS.url()}`);
  }
  await pS.goto(`${BASE}/dashboard/customers`);
  const t2 = await bodyText(pS);
  const canDelete = t2.includes("삭제");
  return `고객 화면에 '삭제' 노출=${canDelete}`;
});

await step("12 직원 계정에 삭제 기능이 노출되지 않고 실행도 안 됨 (고객/예약/시술)", pS, async () => {
  const obs = [];
  // 고객 삭제: 상세 화면에 버튼이 보이는지, 실제로 눌러서 삭제되는지
  const [tmp] = await svc("POST", "customers", { business_id: ids.bizA, name: "삭제시험-고객", phone: "010-0000-0001" });
  await pS.goto(`${BASE}/dashboard/customers/${tmp.id}`);
  const del = pS.locator("button", { hasText: "고객 삭제" });
  const visible = await del.count();
  obs.push(`고객삭제 버튼 노출=${visible > 0}`);
  if (visible) {
    pS.once("dialog", (d) => d.accept());
    await del.first().click();
    await pS.waitForTimeout(1500);
    const left = await svc("GET", `customers?id=eq.${tmp.id}&select=id`);
    obs.push(`직원이 실제로 삭제함=${left.length === 0}`);
  }
  // 예약 삭제 / 시술 삭제 버튼 노출
  await pS.goto(`${BASE}/dashboard/reservations/${ids.resA}`);
  obs.push(`예약삭제 노출=${(await pS.locator("button", { hasText: "삭제" }).count()) > 0}`);
  await pS.goto(`${BASE}/dashboard/services`);
  obs.push(`시술삭제 노출=${(await pS.locator("button", { hasText: "삭제" }).count()) > 0}`);
  expect(!obs.some((o) => o.endsWith("=true")), `직원에게 삭제 기능이 노출/실행됨: ${obs.join(" · ")}`);
  return obs.join(" · ");
});

// ── 13. 매장 A vs B 격리 ────────────────────────────────────────────
await step("B 매장 가입/온보딩 + 데이터 생성 [B]", pB, async () => {
  const note = await signupAndOnboard(pB, B, "B");
  const [p] = await svc("GET", `profiles?id=eq.${await userIdByEmail(B.email)}&select=business_id`);
  ids.bizB = p.business_id;
  const [c] = await svc("POST", "customers", { business_id: ids.bizB, name: "B고객-비밀", phone: "010-9999-8888", memo: "B전용메모" });
  ids.custB = c.id;
  const [st] = await svc("POST", "staff", { business_id: ids.bizB, name: "B직원-비밀", role: "staff" });
  ids.staffB = st.id;
  const start = new Date(Date.now() + 86_400_000);
  const [r] = await svc("POST", "reservations", { business_id: ids.bizB, customer_id: ids.custB, start_time: start.toISOString(), end_time: new Date(start.getTime() + 3_600_000).toISOString(), content: "B전용예약", status: "confirmed", source: "internal" });
  ids.resB = r.id;
  const [pay] = await svc("POST", "payments", { business_id: ids.bizB, customer_id: ids.custB, gross_amount: 777000, discount_amount: 0, amount: 777000, status: "paid", paid_at: new Date().toISOString(), memo: "B전용매출" });
  ids.payB = pay.id;
  return note;
});

await step("13 A 계정: B 고객/예약/매출/직원이 목록·검색에 안 보임", pA, async () => {
  const leaks = [];
  const listPages = { "/dashboard/customers": ["B고객-비밀", "B전용메모"], "/dashboard/reservations/search": [], "/dashboard/staff": ["B직원-비밀"], "/dashboard/sales/history": ["B고객-비밀", "777,000"], "/dashboard/consultations": ["B고객-비밀"], "/dashboard": ["B전용예약", "B고객-비밀"] };
  for (const [p, needles] of Object.entries(listPages)) {
    await pA.goto(`${BASE}${p}`);
    await pA.waitForLoadState("networkidle").catch(() => {});
    const text = await bodyText(pA);
    for (const nd of needles) if (text.includes(nd)) leaks.push(`${p}: '${nd}'`);
  }
  // 예약고객 검색 화면에서 B 고객 검색
  await pA.goto(`${BASE}/dashboard/reservations/search`);
  const box = pA.locator("input[type=text], input:not([type])").first();
  await box.fill("B고객");
  await pA.keyboard.press("Enter");
  await pA.waitForTimeout(1500);
  if ((await bodyText(pA)).includes("B고객-비밀")) leaks.push("예약고객 검색: 'B고객-비밀'");
  expect(leaks.length === 0, `유출: ${leaks.join(" | ")}`);
  return `${Object.keys(listPages).length + 1}개 화면 확인`;
});

await step("13 A 계정: B 데이터 URL 직접 접근(IDOR) 차단", pA, async () => {
  const urls = [`/dashboard/customers/${ids.custB}`, `/dashboard/reservations/${ids.resB}`, `/dashboard/reservations/${ids.resB}/pay`];
  const leaks = [];
  for (const u of urls) {
    const resp = await pA.goto(`${BASE}${u}`);
    await pA.waitForLoadState("networkidle").catch(() => {});
    const text = await bodyText(pA);
    const status = resp?.status();
    const leaked = ["B고객-비밀", "B전용메모", "B전용예약", "010-9999-8888"].some((s) => text.includes(s));
    if (leaked) leaks.push(`${u} (status ${status})`);
  }
  expect(leaks.length === 0, `B 정보가 표시됨: ${leaks.join(", ")}`);
  return `${urls.length}개 URL 모두 B 정보 미표시`;
});

await step("13 B 계정도 A 데이터가 안 보임 (반대 방향)", pB, async () => {
  const leaks = [];
  for (const p of ["/dashboard/customers", "/dashboard/sales/history", "/dashboard/consultations", `/dashboard/customers/${ids.custA}`, `/dashboard/reservations/${ids.resA}`]) {
    await pB.goto(`${BASE}${p}`);
    await pB.waitForLoadState("networkidle").catch(() => {});
    const text = await bodyText(pB);
    if (["A고객-홍길동", "염색 상담", "남성 커트"].some((s) => text.includes(s))) leaks.push(p);
  }
  expect(leaks.length === 0, `유출: ${leaks.join(", ")}`);
});

// ── 정리 및 요약 ────────────────────────────────────────────────────
await browser.close();
if (!args.keep) {
  // 이번 실행 + 이전 --keep 실행이 남긴 e2e 계정을 모두 정리 (삭제하면 소속 매장 데이터도 함께 삭제됨)
  const all = await adminUser("GET", "?per_page=200");
  for (const u of all.users.filter((u) => /^e2e-[abs]-[0-9a-f]+@gmail\.com$/.test(u.email ?? ""))) {
    await adminUser("DELETE", `/${u.id}`).catch(() => {});
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과  ·  스크린샷: ${path.relative(process.cwd(), shotDir)}${args.keep ? "  ·  테스트 계정 유지(--keep)" : "  ·  테스트 계정 삭제됨"}`);
if (failed.length) {
  console.log("\n실패 항목:");
  for (const f of failed) console.log(`  ${f.id} ${f.label}: ${f.note}`);
}
process.exit(failed.length ? 1 : 0);

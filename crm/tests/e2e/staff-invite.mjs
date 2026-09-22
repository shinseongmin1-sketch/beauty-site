// 직원 계정 초대 화면 검증 (F2) — 실제 Edge 브라우저, 테스트 Supabase 프로젝트 전용.
//   npm run dev:test  →  node tests/e2e/staff-invite.mjs [--headless]
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
async function mkUser(label) {
  const email = `ivt-${run}-${label}@gmail.com`;
  const u = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: `T-${label}` } });
  created.push(u.id);
  return { id: u.id, email };
}
const rpcCreateBiz = async (user, name) => {
  const l = await (await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, password: PW }) })).json();
  return await (await fetch(`${t.url}/rest/v1/rpc/create_my_business`, { method: "POST", headers: { apikey: t.anonKey, Authorization: `Bearer ${l.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_name: name, p_business_number_hash: crypto.randomBytes(32).toString("hex") }) })).json();
};
const canLogin = async (email, password) => (await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).ok;

const rows = [];
const record = (name, ok, note = "") => { rows.push({ name, ok, note }); console.log(`  ${ok ? "✔" : "✖"} ${name}${note ? `  — ${note}` : ""}`); };
async function check(name, fn) { try { const note = await fn(); record(name, true, note ?? ""); } catch (e) { record(name, false, e.message.split(String.fromCharCode(10))[0]); } }
const expect = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch({ channel: "msedge", headless: Boolean(args.headless), slowMo: args.headless ? 0 : 150 });
async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  if (user) {
    await page.goto(`${BASE}/login`);
    await page.fill("input[name=email]", user.email);
    await page.fill("input[name=password]", PW);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/dashboard/);
  }
  return { ctx, page };
}
const openInvite = async (page, rowText) => {
  await page.goto(`${BASE}/dashboard/staff`);
  await page.locator("tr", { hasText: rowText }).locator("button", { hasText: /계정 초대|다시 초대/ }).click();
};

console.log(`\n▶ 대상: ${BASE} → 테스트 Supabase(${t.ref})\n`);

try {
  const uO = await mkUser("owner"), uM = await mkUser("manager"), uY = await mkUser("yowner");
  const bizA = await rpcCreateBiz(uO, `초대시험-A-${run}`);
  const bizY = await rpcCreateBiz(uY, `초대시험-Y-${run}`);
  await svc("PATCH", `profiles?id=eq.${uM.id}`, { business_id: bizA, role: "manager" });
  await svc("POST", "staff", { business_id: bizA, profile_id: uM.id, name: "관리자계정", role: "manager" });
  const stStaff = (await svc("POST", "staff", { business_id: bizA, name: "신규직원", role: "staff", phone: "010-2222-3333" }))[0].id;
  const stMgrRow = (await svc("POST", "staff", { business_id: bizA, name: "신규관리자", role: "manager" }))[0].id;
  await svc("POST", "customers", { business_id: bizA, name: "A고객-초대시험" });
  await svc("POST", "customers", { business_id: bizY, name: "Y고객-비밀" });

  const O = await session(uO);
  const M = await session(uM);
  const inviteeEmail = `ivt-${run}-invitee@gmail.com`;
  let link = "";

  // ── 초대 링크 만들기 (대표 화면) ───────────────────────────────────
  await check("대표: 담당자 화면에서 '계정 초대' → 이메일 입력 → 초대 링크 생성", async () => {
    await openInvite(O.page, "신규직원");
    await O.page.locator("input[name=invite_email]").fill(inviteeEmail);
    await O.page.getByRole("button", { name: "초대 링크 만들기" }).click();
    const box = O.page.locator("input[aria-label='초대 링크']");
    await box.waitFor();
    link = await box.inputValue();
    expect(/\/invite\/[A-Za-z0-9_-]{40,}$/.test(link), `링크 형식 이상: ${link.slice(0, 60)}`);
    await O.page.screenshot({ path: path.join(shotDir, "inv-1-link-created.png") });
    return `링크 ${link.length}자, 토큰은 DB 에 해시로만 저장`;
  });
  await check("DB: 토큰 원본은 저장되지 않고 해시만 저장 (링크의 토큰 ≠ DB 값)", async () => {
    const token = link.split("/invite/")[1];
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const inv = await svc("GET", `staff_invitations?staff_id=eq.${stStaff}&select=token_hash,email,role`);
    expect(inv.length === 1 && inv[0].token_hash === hash && inv[0].token_hash !== token, "저장된 값이 해시와 다름");
    expect(inv[0].email === inviteeEmail && inv[0].role === "staff", "초대 이메일/직급 불일치");
  });
  await check("대표 화면: 해당 담당자가 '초대 대기중'으로 표시", async () => {
    await O.page.goto(`${BASE}/dashboard/staff`);
    const text = await O.page.locator("tr", { hasText: "신규직원" }).innerText();
    expect(text.includes("초대 대기중") && text.includes(inviteeEmail), text);
  });

  // ── 관리자 화면 권한 ────────────────────────────────────────────────
  await check("관리자 화면: 직원급 담당자는 초대 가능, 관리자급 담당자는 초대 버튼 없음", async () => {
    await M.page.goto(`${BASE}/dashboard/staff`);
    const staffRow = await M.page.locator("tr", { hasText: "신규직원" }).innerText();
    const mgrRow = await M.page.locator("tr", { hasText: "신규관리자" }).innerText();
    expect(staffRow.includes("다시 초대") || staffRow.includes("초대 대기중"), "직원급 행에 초대 UI 없음");
    expect(!mgrRow.includes("계정 초대") && !mgrRow.includes("다시 초대"), "관리자급 행에 초대 버튼이 보임");
  });

  // ── 수락 화면 (로그인 안 된 새 브라우저) ─────────────────────────────
  const N = await session(null);
  await check("초대 링크 페이지: 매장명/초대 이메일 표시, 이메일은 수정 불가", async () => {
    await N.page.goto(link);
    const text = await N.page.locator("body").innerText();
    expect(text.includes(`초대시험-A-${run}`), "매장명이 안 보임");
    expect((await N.page.locator("input[type=email][readonly]").inputValue()) === inviteeEmail, "초대 이메일이 다름/수정 가능");
    expect(!text.includes("초대시험-Y"), "다른 매장 정보가 보임");
    await N.page.screenshot({ path: path.join(shotDir, "inv-2-accept-page.png") });
  });
  await check("수락: 비밀번호 8자 미만 / 불일치는 한글 오류 안내", async () => {
    await N.page.fill("input[name=password]", "short");
    await N.page.fill("input[name=password_confirm]", "short");
    await N.page.evaluate(() => document.querySelectorAll("input[minlength]").forEach((i) => i.removeAttribute("minlength")));
    await N.page.click("button[type=submit]");
    await N.page.waitForSelector("text=8자 이상이어야");
    await N.page.fill("input[name=password]", PW);
    await N.page.fill("input[name=password_confirm]", `${PW}x`);
    await N.page.click("button[type=submit]");
    await N.page.waitForSelector("text=서로 다릅니다");
  });
  await check("수락: 이름·비밀번호 설정 → 계정 생성 → 자동 로그인 → 대시보드", async () => {
    await N.page.fill("input[name=full_name]", "초대받은직원");
    await N.page.fill("input[name=password]", PW);
    await N.page.fill("input[name=password_confirm]", PW);
    await N.page.click("button[type=submit]");
    await N.page.waitForURL(/\/dashboard/);
    const text = await N.page.locator("body").innerText();
    expect(text.includes(`초대시험-A-${run}`) && text.includes("초대받은직원"), "대시보드에 매장/이름이 안 보임");
    await N.page.screenshot({ path: path.join(shotDir, "inv-3-invitee-dashboard.png"), fullPage: true });
  });
  await check("DB: 계정이 담당자 레코드와 연결되고 초대된 사업장·직급(직원)으로 고정", async () => {
    const [s] = await svc("GET", `staff?id=eq.${stStaff}&select=profile_id`);
    expect(s.profile_id, "staff.profile_id 가 비어 있음");
    const [p] = await svc("GET", `profiles?id=eq.${s.profile_id}&select=business_id,role,full_name`);
    expect(p.business_id === bizA && p.role === "staff" && p.full_name === "초대받은직원", JSON.stringify(p));
    const [inv] = await svc("GET", `staff_invitations?staff_id=eq.${stStaff}&select=accepted_at`);
    expect(inv.accepted_at, "초대가 수락 처리되지 않음");
  });
  await check("초대받은 직원 화면: 직원 권한 그대로 (매출/설정/마케팅/담당자 메뉴 없음), 다른 매장 데이터 없음", async () => {
    const menu = await N.page.locator("aside").innerText();
    for (const label of ["매출관리", "마케팅", "설정", "담당자", "시술/메뉴"]) expect(!menu.includes(label), `'${label}' 메뉴가 보임`);
    await N.page.goto(`${BASE}/dashboard/customers`);
    await N.page.waitForSelector("text=A고객-초대시험");
    const text = await N.page.locator("body").innerText();
    await N.page.screenshot({ path: path.join(shotDir, "inv-3b-invitee-customers.png"), fullPage: true });
    expect(text.includes("A고객-초대시험") && !text.includes("Y고객-비밀"), `고객 목록 격리 실패: A고객 표시=${text.includes("A고객-초대시험")}, Y고객 표시=${text.includes("Y고객-비밀")}, url=${N.page.url()}`);
    for (const u of ["/dashboard/sales", "/dashboard/staff", "/dashboard/settings", "/dashboard/marketing"]) {
      await N.page.goto(`${BASE}${u}`);
      await N.page.waitForLoadState("networkidle").catch(() => {});
      expect(new URL(N.page.url()).pathname === "/dashboard", `${u} 접근 가능`);
    }
  });
  await check("사용한 초대 링크를 다시 열면 '사용할 수 없음' 안내 (1회용)", async () => {
    const R = await session(null);
    await R.page.goto(link);
    expect((await R.page.locator("body").innerText()).includes("초대 링크를 사용할 수 없습니다"), "재사용 안내가 없음");
    await R.ctx.close();
  });
  await check("엉터리 링크는 '사용할 수 없음' 안내 (정보 노출 없음)", async () => {
    const R = await session(null);
    await R.page.goto(`${BASE}/invite/${crypto.randomBytes(32).toString("base64url")}`);
    const text = await R.page.locator("body").innerText();
    expect(text.includes("초대 링크를 사용할 수 없습니다") && !text.includes("초대시험"), "안내가 이상함");
    await R.ctx.close();
  });

  // ── 연결 해제 (대표 화면) ───────────────────────────────────────────
  await check("대표 화면: 담당자가 '연결됨'으로 표시되고 삭제 버튼은 사라짐", async () => {
    await O.page.goto(`${BASE}/dashboard/staff`);
    const row = O.page.locator("tr", { hasText: "신규직원" });
    const text = await row.innerText();
    expect(text.includes("연결됨") && text.includes("연결 해제"), "연결 상태 표시가 없음");
    expect((await row.locator("button", { hasText: /^삭제$/ }).count()) === 0, "연결된 담당자에 삭제 버튼이 보임");
    await O.page.screenshot({ path: path.join(shotDir, "inv-4-owner-linked.png"), fullPage: true });
  });
  await check("연결 해제: 즉시 접근 불가 + 로그인 계정 삭제, 예약·고객 기록은 유지", async () => {
    O.page.once("dialog", (d) => d.accept());
    await O.page.locator("tr", { hasText: "신규직원" }).locator("button", { hasText: "연결 해제" }).click();
    await O.page.waitForSelector("text=로그인 계정 연결을 해제했습니다");
    const [s] = await svc("GET", `staff?id=eq.${stStaff}&select=profile_id,name`);
    expect(s.profile_id === null && s.name === "신규직원", "담당자 행/연결 상태가 이상함");
    expect(!(await canLogin(inviteeEmail, PW)), "해제된 계정이 아직 로그인됨");
    expect((await svc("GET", `customers?business_id=eq.${bizA}&select=id`)).length === 1, "고객 기록이 사라짐");
    // 이미 열려 있던 직원 브라우저 세션도 데이터를 못 본다
    await N.page.goto(`${BASE}/dashboard/customers`);
    await N.page.waitForLoadState("networkidle").catch(() => {});
    const after = new URL(N.page.url()).pathname;
    expect(after === "/login" || after === "/onboarding", `해제된 직원이 대시보드에 남아 있음: ${after}`);
    return `해제된 직원의 기존 세션 → ${after}`;
  });
  await check("해제 후 같은 담당자를 다시 초대할 수 있다 (같은 이메일 재사용 가능)", async () => {
    await openInvite(O.page, "신규직원");
    await O.page.locator("input[name=invite_email]").fill(inviteeEmail);
    await O.page.getByRole("button", { name: "초대 링크 만들기" }).click();
    await O.page.locator("input[aria-label='초대 링크']").waitFor();
  });
} catch (e) {
  record("테스트 스크립트 오류", false, e.message.split(String.fromCharCode(10))[0]);
} finally {
  await browser.close();
  const all = await fetch(`${t.url}/auth/v1/admin/users?per_page=200`, { headers: SH }).then((r) => r.json()).catch(() => ({ users: [] }));
  for (const u of (all.users ?? []).filter((u) => /^ivt-[0-9a-f]+-/.test(u.email ?? ""))) await fetch(`${t.url}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: SH }).catch(() => {});
}

const failed = rows.filter((r) => !r.ok);
console.log(`\n결과: ${rows.length - failed.length}/${rows.length} 통과`);
if (failed.length) { console.log("\n실패:"); for (const f of failed) console.log(`  ${f.name}: ${f.note}`); }
process.exit(failed.length ? 1 : 0);

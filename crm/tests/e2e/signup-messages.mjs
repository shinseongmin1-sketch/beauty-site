// 가입 화면 문구/오류 메시지(F4) 검증 — 테스트 Supabase 프로젝트 전용.
//   npm run dev:test  →  node tests/e2e/signup-messages.mjs
// 원래 보고된 오류(Email address "..." is invalid)는 이메일 확인이 켜져 있을 때 나오므로,
// 그 케이스만 테스트 프로젝트의 mailer_autoconfirm 을 잠깐 끄고 재현한 뒤 반드시 원래대로 되돌린다.
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import { loadTarget, parseArgs } from "../../scripts/lib/env.mjs";

const args = parseArgs();
const t = loadTarget("test");
const BASE = args.base ?? "http://localhost:3100";
const run = crypto.randomBytes(3).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const SH = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };

const rows = [];
const check = async (name, fn) => {
  try { const note = await fn(); rows.push({ name, ok: true }); console.log(`  ✔ ${name}${note ? `  — ${note}` : ""}`); }
  catch (e) { rows.push({ name, ok: false, note: e.message }); console.log(`  ✖ ${name}  — ${e.message.split(String.fromCharCode(10))[0]}`); }
};
const expect = (c, m) => { if (!c) throw new Error(m); };
const ENGLISH_LEAK = /(email address|is invalid|already registered|already been|rate limit|password should|AuthApiError)/i;

const mgmt = (method, body) => fetch(`https://api.supabase.com/v1/projects/${t.ref}/config/auth`, { method, headers: { Authorization: `Bearer ${t.accessToken}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
async function setAutoconfirm(value) {
  const r = await mgmt("PATCH", { mailer_autoconfirm: value });
  if (!r.ok) throw new Error(`mailer_autoconfirm=${value} 설정 실패 (${r.status})`);
  // 인증 서버가 새 설정을 반영하는 데 몇 초 걸린다
  await new Promise((res) => setTimeout(res, 8000));
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
// 매 시도마다 새 브라우저 세션 (이전 가입으로 로그인된 상태가 남지 않게)
async function signup(email, password) {
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${BASE}/signup`);
  await page.fill("input[name=full_name]", "홍길동");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  return page;
}
const errorText = async (page) => {
  await page.waitForSelector("p.bg-red-50");
  return page.locator("p.bg-red-50").first().innerText();
};

console.log(`\n▶ 대상: ${BASE} → 테스트 Supabase(${t.ref})\n`);
try {
  await check("가입 화면 제목이 '3개월 무료체험 시작' (홈페이지와 일치, '30일' 없음)", async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE}/signup`);
    const h1 = await page.locator("h1").innerText();
    expect(h1.includes("3개월 무료체험") && !h1.includes("30일"), h1);
  });
  await check("로그인 화면의 가입 링크도 '3개월 무료체험 시작'", async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE}/login`);
    const link = await page.locator("a[href='/signup']").innerText();
    expect(link.includes("3개월 무료체험") && !link.includes("30일"), link);
  });

  await check("[재현] 이메일 확인이 켜진 상태에서 유효하지 않은 이메일 → 영문 원문 대신 한글 안내", async () => {
    await setAutoconfirm(false);
    try {
      const page = await signup(`nobody-${run}@example.com`, PW);
      const msg = await errorText(page);
      // 최근 실행으로 이메일 발송 한도(시간당 2회)에 걸린 경우에도 한글 안내가 나와야 한다
      expect((msg.includes("사용할 수 없는 이메일") || msg.includes("요청이 너무 많습니다")) && !ENGLISH_LEAK.test(msg), msg);
      return msg;
    } finally {
      await setAutoconfirm(true);
    }
  });

  await check("이미 가입된 이메일 → 한글 안내, 영문 원문 노출 없음", async () => {
    const existing = `dup-${run}@gmail.com`;
    const r = await fetch(`${t.url}/auth/v1/admin/users`, { method: "POST", headers: SH, body: JSON.stringify({ email: existing, password: PW, email_confirm: true }) });
    expect(r.ok, "사전 계정 생성 실패");
    const page = await signup(existing, PW);
    const msg = await errorText(page);
    expect(msg.includes("이미 가입된 이메일") && !ENGLISH_LEAK.test(msg), msg);
    return msg;
  });

  await check("6자 미만 비밀번호 → 한글 안내 (기존 동작 유지)", async () => {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${BASE}/signup`);
    await page.fill("input[name=full_name]", "홍길동");
    await page.fill("input[name=email]", `short-${run}@gmail.com`);
    await page.fill("input[name=password]", "12345");
    await page.evaluate(() => document.querySelectorAll("input[minlength]").forEach((i) => i.removeAttribute("minlength")));
    await page.click("button[type=submit]");
    const msg = await errorText(page);
    expect(msg.includes("6자 이상") && !ENGLISH_LEAK.test(msg), msg);
  });
} finally {
  await setAutoconfirm(true).catch(() => {}); // 어떤 경우에도 원래 상태로 복구
  await browser.close();
  const all = await fetch(`${t.url}/auth/v1/admin/users?per_page=200`, { headers: SH }).then((r) => r.json()).catch(() => ({ users: [] }));
  for (const u of (all.users ?? []).filter((u) => /^(dup|short|nobody)-[0-9a-f]+@/.test(u.email ?? ""))) await fetch(`${t.url}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: SH }).catch(() => {});
}
const failed = rows.filter((r) => !r.ok);
console.log(`\n결과: ${rows.length - failed.length}/${rows.length} 통과`);
process.exit(failed.length ? 1 : 0);

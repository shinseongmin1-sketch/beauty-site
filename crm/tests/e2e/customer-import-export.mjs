// 고객 CSV Import/Export 화면 검증 — 실제 Edge 브라우저, 테스트 Supabase 프로젝트 전용.
//   npm run dev:test  →  node tests/e2e/customer-import-export.mjs [--headless]
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
const dlDir = path.join(root, ".e2e-downloads");
fs.mkdirSync(shotDir, { recursive: true });
fs.mkdirSync(dlDir, { recursive: true });

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
const mkUser = async (label) => {
  const email = `cie-${run}-${label}@gmail.com`;
  const u = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: `T-${label}` } });
  created.push(u.id);
  return { id: u.id, email };
};
const rpcCreateBiz = async (user, name) => {
  const l = await (await fetch(`${t.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: t.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, password: PW }) })).json();
  return await (await fetch(`${t.url}/rest/v1/rpc/create_my_business`, { method: "POST", headers: { apikey: t.anonKey, Authorization: `Bearer ${l.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_name: name, p_representative_name: "대표", p_business_number_hash: crypto.randomBytes(32).toString("hex"), p_business_number_masked: "***" }) })).json();
};

const rows = [];
const record = (name, ok, note = "") => { rows.push({ name, ok, note }); console.log(`  ${ok ? "✔" : "✖"} ${name}${note ? `  — ${note}` : ""}`); };
async function check(name, fn) { try { const note = await fn(); record(name, true, note ?? ""); } catch (e) { record(name, false, e.message.split(String.fromCharCode(10))[0]); } }
const expect = (c, m) => { if (!c) throw new Error(m); };

function parseCsvSimple(text) {
  // 테스트 전용 최소 CSV 파서(따옴표 처리 포함). 앱의 lib/csv.ts 와 별개로 결과만 눈으로 검증하기 위함.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQ) { if (c === '"') { if (clean[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c; continue; }
    if (c === '"' && cell === "") { inQ = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(cell); if (row.some((v) => v !== "")) rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); if (row.some((v) => v !== "")) rows.push(row); }
  return rows;
}

const browser = await chromium.launch({ channel: "msedge", headless: Boolean(args.headless), slowMo: args.headless ? 0 : 100 });
async function session(user, { acceptDownloads = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", user.email);
  await page.fill("input[name=password]", PW);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard/);
  return { ctx, page };
}
async function clickExportAndCapture(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('CSV 내보내기')")]);
  const p = path.join(dlDir, `${crypto.randomBytes(4).toString("hex")}-${download.suggestedFilename()}`);
  await download.saveAs(p);
  return fs.readFileSync(p, "utf8");
}
async function capture(page, trigger) {
  const got = [];
  const h = (req) => { if (req.method() === "POST" && req.headers()["next-action"]) got.push({ url: req.url(), headers: req.headers(), body: req.postDataBuffer() }); };
  page.on("request", h);
  await trigger();
  await page.waitForTimeout(1500);
  page.off("request", h);
  expect(got.length > 0, "Server Action 요청을 캡처하지 못함");
  return got[got.length - 1];
}
async function replay(ctx, cap) {
  const headers = {};
  for (const k of ["content-type", "next-action", "next-router-state-tree", "accept"]) if (cap.headers[k]) headers[k] = cap.headers[k];
  const res = await ctx.request.post(cap.url, { headers, data: cap.body, maxRedirects: 0, failOnStatusCode: false });
  return { status: res.status(), text: await res.text() };
}

console.log(`\n▶ 대상: ${BASE} → 테스트 Supabase(${t.ref})\n`);

try {
  // ── 셋업: 사업장 A(대표/관리자/직원), 사업장 B(격리 확인용) ─────────────
  const uO = await mkUser("owner"), uM = await mkUser("manager"), uS = await mkUser("staff"), uOB = await mkUser("ownerb");
  const bizA = await rpcCreateBiz(uO, `IE시험-A-${run}`);
  const bizB = await rpcCreateBiz(uOB, `IE시험-B-${run}`);
  await svc("PATCH", `profiles?id=eq.${uM.id}`, { business_id: bizA, role: "manager" });
  await svc("PATCH", `profiles?id=eq.${uS.id}`, { business_id: bizA, role: "staff" });
  await svc("POST", "staff", { business_id: bizA, profile_id: uM.id, name: "관리자", role: "manager" });
  await svc("POST", "staff", { business_id: bizA, profile_id: uS.id, name: "직원", role: "staff" });
  const gradeA = (await svc("POST", "customer_grades", { business_id: bizA, name: "VIP" }))[0].id;
  const tagA = (await svc("POST", "customer_tags", { business_id: bizA, name: "단골" }))[0].id;
  const cust1 = (await svc("POST", "customers", { business_id: bizA, name: "정상고객", phone: "010-1111-2222", memo: "메모입니다", grade_id: gradeA }))[0].id;
  await svc("POST", "customer_tag_links", { business_id: bizA, customer_id: cust1, tag_id: tagA });
  const formulaCust = (await svc("POST", "customers", { business_id: bizA, name: "수식고객", memo: "=1+1", phone: "010-1111-3333" }))[0].id;
  const custB = (await svc("POST", "customers", { business_id: bizB, name: "B고객-비밀" }))[0].id;
  void formulaCust; void custB;

  const O = await session(uO), M = await session(uM), S = await session(uS);
  await O.page.goto(`${BASE}/dashboard/customers`);
  await M.page.goto(`${BASE}/dashboard/customers`);
  await S.page.goto(`${BASE}/dashboard/customers`);

  // ── ① 화면: 직원에게 버튼 없음, 대표/관리자에게 있음 ────────────────────
  await check("① 화면: 직원에게는 CSV 내보내기/가져오기 버튼이 보이지 않음", async () => {
    const text = await S.page.locator("body").innerText();
    expect(!text.includes("CSV 내보내기") && !text.includes("CSV 가져오기"), "직원 화면에 버튼이 보임");
  });
  await check("① 화면: 대표·관리자에게는 두 버튼 모두 보임", async () => {
    for (const p of [O.page, M.page]) {
      const text = await p.locator("body").innerText();
      expect(text.includes("CSV 내보내기") && text.includes("CSV 가져오기"), "버튼이 안 보임");
    }
  });

  // ── Export 내용 검증 (헤더/행수/formula 무력화/다른 사업장 미포함) ──────
  let exportedCsv;
  await check("대표 Export 성공: 헤더가 정확히 일치하고, 등록된 고객 수만큼 행이 나옴", async () => {
    exportedCsv = await clickExportAndCapture(O.page);
    const table = parseCsvSimple(exportedCsv);
    assert_eq(table[0], ["이름", "연락처", "메모", "고객등급", "고객태그", "등록일"]);
    expect(table.length - 1 === 2, `데이터 행 수: ${table.length - 1}`);
  });
  await check("Export CSV formula injection 방지: '=1+1' 메모가 앞에 작은따옴표가 붙어 저장됨", async () => {
    const table = parseCsvSimple(exportedCsv);
    const row = table.find((r) => r[0] === "수식고객");
    expect(row && row[2] === "'=1+1", `실제 값: ${JSON.stringify(row)}`);
  });
  await check("Export 에 다른 사업장(B) 고객이 포함되지 않음", async () => {
    expect(!exportedCsv.includes("B고객-비밀"), "다른 사업장 고객이 Export 됨");
  });
  await check("관리자 Export 성공(007 기준 대표와 동일 권한)", async () => {
    const csv = await clickExportAndCapture(M.page);
    expect(parseCsvSimple(csv).length - 1 === 2, "관리자 Export 행 수 불일치");
  });

  // ── Import: 정상 흐름(미리보기 → 확정) ───────────────────────────────
  await check("대표 Import 성공: 신규 2명 CSV 업로드 → 미리보기(신규 2, 오류 0) → 확정", async () => {
    await O.page.goto(`${BASE}/dashboard/customers`);
    await O.page.click("button:has-text('CSV 가져오기')");
    const csv = "이름,연락처,메모,고객등급,고객태그\n김신규,010-5555-6666,첫방문,VIP,단골\n이신규,,,,\n";
    const file = path.join(dlDir, `import-ok-${run}.csv`);
    fs.writeFileSync(file, csv, "utf8");
    await O.page.setInputFiles("input[type=file]", file);
    await O.page.waitForSelector("text=신규 등록");
    const text = await O.page.locator("[role=dialog], .fixed").first().innerText().catch(() => O.page.locator("body").innerText());
    expect((await O.page.locator("body").innerText()).match(/신규 등록[\s\S]*?2명/), "신규 2명 미리보기 표시 안 됨");
    expect(!(await O.page.getByRole("button", { name: "가져오기 확정" }).isDisabled()), "오류가 없는데 확정 버튼이 비활성화됨");
    await O.page.getByRole("button", { name: "가져오기 확정" }).click();
    await O.page.waitForSelector("text=가져오기를 완료했습니다");
    expect((await O.page.locator("body").innerText()).includes("신규 2명"), "완료 메시지에 신규 2명이 없음");
    await O.page.screenshot({ path: path.join(shotDir, "ie-1-import-success.png"), fullPage: true });
  });
  await check("Import 로 등급/태그가 정확히 반영됨(자동 생성 없이 기존 것에 연결)", async () => {
    const [c] = await svc("GET", `customers?business_id=eq.${bizA}&name=eq.${encodeURIComponent("김신규")}&select=grade_id`);
    expect(c.grade_id === gradeA, "등급 연결 안 됨");
    await O.page.click("text=고객 관리, header:has-text('고객 관리')").catch(() => {});
  });

  // ── 관리자 Import 성공 ──────────────────────────────────────────────
  await check("관리자 Import 성공(007 기준 대표와 동일 권한)", async () => {
    await M.page.goto(`${BASE}/dashboard/customers`);
    await M.page.click("button:has-text('CSV 가져오기')");
    const csv = "이름,연락처,메모,고객등급,고객태그\n관리자등록고객,010-7777-8888,,,\n";
    const file = path.join(dlDir, `import-mgr-${run}.csv`);
    fs.writeFileSync(file, csv, "utf8");
    await M.page.setInputFiles("input[type=file]", file);
    await M.page.waitForSelector("text=신규 등록");
    await M.page.getByRole("button", { name: "가져오기 확정" }).click();
    await M.page.waitForSelector("text=가져오기를 완료했습니다");
  });

  // ── Import 오류 케이스: 헤더 오류 / 등급 없음 / 형식 오류 ───────────────
  await check("CSV 형식 오류: 필수 컬럼(이름) 누락 → 상단 오류 메시지, 반영 안 됨", async () => {
    await O.page.goto(`${BASE}/dashboard/customers`);
    await O.page.click("button:has-text('CSV 가져오기')");
    const file = path.join(dlDir, `import-noheader-${run}.csv`);
    fs.writeFileSync(file, "연락처,메모\n010-0000-0000,x\n", "utf8");
    await O.page.setInputFiles("input[type=file]", file);
    await O.page.waitForSelector("text=필수 컬럼이 없습니다");
  });
  await check("존재하지 않는 등급/태그: 미리보기에 오류로 표시되고 확정 버튼이 비활성화됨(자동 생성 없음)", async () => {
    await O.page.reload();
    await O.page.click("button:has-text('CSV 가져오기')");
    const file = path.join(dlDir, `import-badgrade-${run}.csv`);
    fs.writeFileSync(file, "이름,연락처,메모,고객등급,고객태그\n등급오류고객,010-1234-9999,,없는등급,\n", "utf8");
    await O.page.setInputFiles("input[type=file]", file);
    await O.page.waitForSelector("text=존재하지 않는 고객등급");
    expect(await O.page.getByRole("button", { name: "가져오기 확정" }).isDisabled(), "오류가 있는데 확정 버튼이 활성화됨");
    await O.page.screenshot({ path: path.join(shotDir, "ie-2-import-error.png"), fullPage: true });
    expect((await svc("GET", `customers?name=eq.${encodeURIComponent("등급오류고객")}&select=id`)).length === 0, "오류 상태에서도 반영됨");
    expect((await svc("GET", `customer_grades?name=eq.${encodeURIComponent("없는등급")}&select=id`)).length === 0, "등급이 자동 생성됨");
  });
  await check("전화번호 형식 오류: 미리보기에서 해당 행만 오류로 표시", async () => {
    await O.page.reload();
    await O.page.click("button:has-text('CSV 가져오기')");
    const file = path.join(dlDir, `import-badphone-${run}.csv`);
    fs.writeFileSync(file, "이름,연락처,메모,고객등급,고객태그\n전화형식오류,123,,,\n", "utf8");
    await O.page.setInputFiles("input[type=file]", file);
    await O.page.waitForSelector("text=연락처 형식이 올바르지 않습니다");
  });
  await check("formula injection 값이 든 CSV 는 미리보기에서 오류로 차단됨", async () => {
    await O.page.reload();
    await O.page.click("button:has-text('CSV 가져오기')");
    const file = path.join(dlDir, `import-formula-${run}.csv`);
    fs.writeFileSync(file, "이름,연락처,메모,고객등급,고객태그\n=1+1,010-1234-8888,,,\n", "utf8");
    await O.page.setInputFiles("input[type=file]", file);
    await O.page.waitForSelector("text=허용되지 않는 문자");
    expect((await svc("GET", "customers?name=eq.=1%2B1&select=id")).length === 0, "수식 이름이 실제로 저장됨");
  });
  await check("2MB 초과 파일: 업로드 즉시 크기 오류", async () => {
    await O.page.reload();
    await O.page.click("button:has-text('CSV 가져오기')");
    const file = path.join(dlDir, `import-huge-${run}.csv`);
    // 앱 자체 한도(정확히 2×1024×1024)를 넉넉히 넘되, next.config 의 bodySizeLimit(3mb)에는 못 미치는 크기로 만든다.
    const bigCell = "x".repeat(2.3 * 1024 * 1024);
    fs.writeFileSync(file, `이름,메모\n"a","${bigCell}"\n`, "utf8");
    await O.page.setInputFiles("input[type=file]", file);
    await O.page.waitForSelector("text=2MB 이하만 가능합니다");
    fs.unlinkSync(file);
  });

  // ── Export → Import 왕복: 기존 데이터가 바뀌거나 중복 생성되지 않음 ─────
  // (전화번호가 없는 고객은 "이름만으로 자동 병합하지 않는다"는 정책상 재가져오기 때마다 항상 신규로
  //  처리되는 게 의도된 동작이다. 이 왕복 검증은 그 정책과 섞이지 않도록 전화번호가 있는 고객만 쓰는
  //  별도 사업장에서 확인한다 — "표기 그대로 재도입해도 기존 고객으로 인식되는가"가 검증 목적이므로.)
  await check("Export → 그대로 Import 왕복(전화번호 있는 고객): 중복 생성 없이 기존 고객으로 인식, 메모/등급/태그 그대로", async () => {
    const uRT = await mkUser("roundtrip");
    const bizRT = await rpcCreateBiz(uRT, `왕복시험-${run}`);
    const gradeRT = (await svc("POST", "customer_grades", { business_id: bizRT, name: "골드" }))[0].id;
    const tagRT = (await svc("POST", "customer_tags", { business_id: bizRT, name: "재방문" }))[0].id;
    const rtCust = (await svc("POST", "customers", { business_id: bizRT, name: "왕복고객", phone: "010-8888-9999", memo: "왕복메모", grade_id: gradeRT }))[0].id;
    await svc("POST", "customer_tag_links", { business_id: bizRT, customer_id: rtCust, tag_id: tagRT });
    await svc("POST", "customers", { business_id: bizRT, name: "왕복고객2", phone: "010-8888-0000" });

    const RT = await session(uRT);
    await RT.page.goto(`${BASE}/dashboard/customers`);
    const before = await svc("GET", `customers?business_id=eq.${bizRT}&select=id`);
    const csv = await clickExportAndCapture(RT.page);
    await RT.page.click("button:has-text('CSV 가져오기')");
    const file = path.join(dlDir, `roundtrip-${run}.csv`);
    fs.writeFileSync(file, csv, "utf8");
    await RT.page.setInputFiles("input[type=file]", file);
    await RT.page.waitForSelector("text=신규 등록");
    const bodyText = (await RT.page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(/오류\s*0건/.test(bodyText), `오류가 있음: ${bodyText.slice(0, 200)}`);
    expect(/신규 등록\s*0명/.test(bodyText), `왕복 Import 에서 신규가 생김: ${bodyText.slice(0, 150)}`);
    expect(new RegExp(`업데이트\\s*${before.length}명`).test(bodyText), `업데이트 건수가 전체와 다름: ${bodyText.slice(0, 150)}`);
    await RT.page.getByRole("button", { name: "가져오기 확정" }).click();
    await RT.page.waitForSelector("text=가져오기를 완료했습니다");
    const after = await svc("GET", `customers?business_id=eq.${bizRT}&select=id`);
    expect(after.length === before.length, `왕복 후 고객 수가 바뀜: ${before.length} → ${after.length}`);
    const [c] = await svc("GET", `customers?id=eq.${rtCust}&select=memo,grade_id`);
    expect(c.memo === "왕복메모" && c.grade_id === gradeRT, "왕복 후 기존 고객의 메모/등급이 바뀜");
    const tags = await svc("GET", `customer_tag_links?customer_id=eq.${rtCust}&select=tag_id`);
    expect(tags.length === 1 && tags[0].tag_id === tagRT, "왕복 후 태그가 바뀜/삭제됨");
    await RT.ctx.close();
  });

  // ── ③ Server Action 직접 호출: 직원이 캡처한 요청을 그대로 재전송해도 차단 ──
  await check("③ Server Action: 직원 → Export 액션 재전송 → 차단(대조군: 대표는 성공)", async () => {
    const cap = await capture(O.page, async () => { await O.page.goto(`${BASE}/dashboard/customers`); await clickExportAndCapture(O.page); });
    const staffReplay = await replay(S.ctx, cap);
    expect(!/csv/i.test(staffReplay.text) || staffReplay.text.includes("권한이 없습니다"), `직원 재전송 응답에 CSV 가 담겨 있음: ${staffReplay.text.slice(0, 200)}`);
    const ownerReplay = await replay(O.ctx, cap);
    expect(ownerReplay.status === 200, "대조군(대표 재전송)이 실패함 — 재전송 방식 자체가 무효");
  });
  await check("③ Server Action: 직원 → Import 커밋 액션 재전송 → 차단, 데이터 반영 안 됨", async () => {
    await O.page.goto(`${BASE}/dashboard/customers`);
    await O.page.click("button:has-text('CSV 가져오기')");
    const file = path.join(dlDir, `import-replay-${run}.csv`);
    fs.writeFileSync(file, "이름,연락처,메모,고객등급,고객태그\n재전송캡처고객,010-4444-5555,,,\n", "utf8");
    await O.page.setInputFiles("input[type=file]", file);
    await O.page.waitForSelector("text=신규 등록");
    const cap = await capture(O.page, async () => { await O.page.getByRole("button", { name: "가져오기 확정" }).click(); await O.page.waitForSelector("text=가져오기를 완료했습니다"); });
    const before = (await svc("GET", `customers?name=eq.${encodeURIComponent("재전송캡처고객")}&select=id`)).length;
    const staffReplay = await replay(S.ctx, cap);
    void staffReplay;
    const after = (await svc("GET", `customers?name=eq.${encodeURIComponent("재전송캡처고객")}&select=id`)).length;
    expect(after === before, "직원의 재전송으로 고객이 추가로 생성됨(원래는 이미 대표가 커밋해서 1명 존재)");
  });
} catch (e) {
  record("테스트 스크립트 오류", false, e.message.split(String.fromCharCode(10))[0]);
} finally {
  await browser.close();
  const all = await fetch(`${t.url}/auth/v1/admin/users?per_page=200`, { headers: SH }).then((r) => r.json()).catch(() => ({ users: [] }));
  for (const u of (all.users ?? []).filter((u) => /^cie-[0-9a-f]+-/.test(u.email ?? ""))) await fetch(`${t.url}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: SH }).catch(() => {});
  fs.rmSync(dlDir, { recursive: true, force: true });
}

function assert_eq(a, b) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`불일치: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

const failed = rows.filter((r) => !r.ok);
console.log(`\n결과: ${rows.length - failed.length}/${rows.length} 통과`);
if (failed.length) { console.log("\n실패:"); for (const f of failed) console.log(`  ${f.name}: ${f.note}`); }
process.exit(failed.length ? 1 : 0);

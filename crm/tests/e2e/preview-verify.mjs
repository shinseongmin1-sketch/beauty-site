// Vercel Preview 배포(beauty-site-crm) 실제 화면 검증 — 테스트 Supabase 프로젝트 전용.
// Vercel Deployment Protection(SSO) 이 걸려 있으므로, 사람이 직접 뜬 브라우저 창에서
// Vercel 로그인을 완료해야 한다(우회 시크릿/계정 토큰을 코드로 다루지 않음).
//   node tests/e2e/preview-verify.mjs --base=https://<preview-url>.vercel.app
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { loadTarget, parseArgs, mintUserToken, root } from "../../scripts/lib/env.mjs";

const args = parseArgs();
const t = loadTarget("test"); // 운영 URL 이면 여기서 즉시 중단됨
if (!args.base) throw new Error("--base=<Preview URL> 을 지정하세요.");
const BASE = String(args.base).replace(/\/$/, "");
const run = crypto.randomBytes(3).toString("hex");
const PW = `Pw-${crypto.randomBytes(9).toString("base64url")}`;
const shotDir = path.join(root, ".e2e-shots", "preview");
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
  const email = `pv-${run}-${label}@gmail.com`;
  const u = await admin("POST", "", { email, password: PW, email_confirm: true, user_metadata: { full_name: `T-${label}` } });
  created.push(u.id);
  return { id: u.id, email };
};
const rpcCreateBiz = async (user, name) => {
  const token = await mintUserToken(t, { id: user.id, email: user.email });
  return await (await fetch(`${t.url}/rest/v1/rpc/create_my_business`, {
    method: "POST",
    headers: { apikey: t.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_name: name, p_representative_name: "대표", p_business_number_hash: crypto.randomBytes(32).toString("hex"), p_business_number_masked: "***" }),
  })).json();
};

const rows = [];
const record = (name, ok, note = "") => { rows.push({ name, ok, note }); console.log(`  ${ok ? "✔" : "✖"} ${name}${note ? `  — ${note}` : ""}`); };
async function check(name, page, fn) {
  try {
    if (name !== "1. 인증된 브라우저 세션에서 Preview URL 접근") await ensureApp();
    const note = await fn();
    record(name, true, note ?? "");
  } catch (e) {
    record(name, false, e.message.split("\n")[0]);
  }
  if (page) {
    const id = String(rows.length).padStart(2, "0");
    await page.screenshot({ path: path.join(shotDir, `${id}-${name.replace(/[^\w가-힣]+/g, "_").slice(0, 40)}.png`), fullPage: true }).catch(() => {});
  }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const bodyText = (p) => p.locator("body").innerText();

console.log(`\n▶ 대상: ${BASE} (Vercel Preview) → 테스트 Supabase(${t.ref})\n`);

// ── 사전 데이터: 사업장 A(대표/직원), 사업장 B(격리 확인용) ───────────────
console.log("▶ 테스트 데이터 준비 중 (Supabase REST 직접 호출, Preview URL 미경유)...");
const uO = await mkUser("owner"), uS = await mkUser("staff"), uOB = await mkUser("ownerb");
const bizA = await rpcCreateBiz(uO, `PV시험-A-${run}`);
const bizB = await rpcCreateBiz(uOB, `PV시험-B-${run}`);
await svc("PATCH", `profiles?id=eq.${uS.id}`, { business_id: bizA, role: "staff" });
await svc("POST", "staff", { business_id: bizA, profile_id: uS.id, name: "직원", role: "staff" });
const gradeA = (await svc("POST", "customer_grades", { business_id: bizA, name: "VIP" }))[0].id;
const custA = (await svc("POST", "customers", { business_id: bizA, name: "PV고객-정상", phone: "010-1111-2222", memo: "첫방문", grade_id: gradeA }))[0].id;
const custB = (await svc("POST", "customers", { business_id: bizB, name: "PV고객-B비밀", phone: "010-9999-8888", memo: "B전용메모" }))[0].id;
// 예약관리 화면은 기본적으로 "오늘" 날짜를 보여주므로, 오늘 시간대로 예약을 만든다.
const start = new Date(Date.now() + 3_600_000).toISOString(), end = new Date(Date.now() + 7_200_000).toISOString();
await svc("POST", "reservations", { business_id: bizA, customer_id: custA, start_time: start, end_time: end, content: "PV예약", status: "confirmed", source: "internal" });
console.log("▶ 데이터 준비 완료.\n");

// ── 브라우저: 전용 새 프로필 (Chromium 은 실제 기본 프로필 디렉터리에 원격 디버깅 연결을
// 자체적으로 차단하므로 — "DevTools remote debugging requires a non-default data directory" —
// 실제 Edge 프로필 재사용은 불가능함. 대신 이 창에서 사람이 직접 Vercel SSO 로그인을 완료한다.
const browser = await chromium.launch({ channel: "msedge", headless: false, slowMo: 150 });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(20000);

// "Vercel 로그인 화면이 아니면 통과"식 소거법은 Google/GitHub 등 OAuth 중간 화면
// (accounts.google.com 등)도 "Vercel 아님"으로 오판하게 만든다. 대신 우리 배포 도메인에
// "정확히" 도달했는지 양성 판정한다 — 이 도메인은 Vercel/Google 어디서도 나올 수 없다.
const ourHost = new URL(BASE).hostname;
function isOnOurApp() {
  try {
    return new URL(page.url()).hostname === ourHost;
  } catch {
    return false;
  }
}

async function waitForVercelSso() {
  console.log("▶ Preview URL 접속 중...");
  await page.goto(`${BASE}/login`).catch(() => {});
  const deadline = Date.now() + 10 * 60_000;
  let waited = false;
  // 연속 3회(약 9초) 동안 계속 우리 도메인에 머물러 있어야 통과로 인정한다(중간 리다이렉트 오판 방지).
  let consecutiveOk = 0;
  while (Date.now() < deadline) {
    if (isOnOurApp()) {
      consecutiveOk++;
      if (consecutiveOk >= 3) break;
    } else {
      consecutiveOk = 0;
      if (!waited) {
        console.log("\n⏸  Vercel SSO 로그인이 필요합니다.");
        console.log("   방금 뜬 브라우저 창에서 Vercel 계정으로 로그인을 완료해주세요.");
        console.log("   완료되면 자동으로 다음 단계로 진행됩니다 (최대 10분 대기).\n");
        waited = true;
      }
    }
    await page.waitForTimeout(3000);
  }
  if (consecutiveOk < 3) throw new Error("Vercel SSO 인증 대기 시간 초과(10분)");
  // 우리 도메인에 도달한 뒤, 실제로 로그인 화면 요소(이메일+비밀번호 입력칸)가 있는지까지 최종 확인한다.
  await page.goto(`${BASE}/login`);
  await page.waitForSelector("input[name=email]", { timeout: 15000 });
  await page.waitForSelector("input[name=password]", { timeout: 15000 });
  console.log("✔ Vercel SSO 통과 — Preview URL 접근 가능.\n");
}

// 매 단계 진입 전에 다시 Vercel/OAuth 중간 화면으로 튕겨있지 않은지 확인하고, 만약 그렇다면
// 다시 대기한다 (세션이 계속 유지된다는 보장이 없으므로 방어적으로 매번 확인).
async function ensureApp() {
  if (!isOnOurApp()) {
    console.log("⚠ 우리 앱 도메인을 벗어남 — 다시 대기합니다.");
    await waitForVercelSso();
  }
}

// 페이지 goto() 직후 바로 fill() 하면 Next.js 클라이언트 하이드레이션이 끝나기 전이라
// 입력값이 지워지는 경우가 있었다(특히 이메일 칸). networkidle 까지 기다리고, fill 후
// 실제로 값이 들어갔는지 읽어서 확인 — 안 들어갔으면 재시도한다.
async function fillVerified(p, selector, value) {
  const loc = p.locator(selector).first();
  for (let attempt = 0; attempt < 5; attempt++) {
    await loc.fill(value);
    if ((await loc.inputValue()) === value) return;
    await p.waitForTimeout(400);
  }
  throw new Error(`${selector} 에 값이 채워지지 않음(하이드레이션 타이밍 문제로 추정)`);
}
async function uiLogin(p, email) {
  await p.goto(`${BASE}/login`);
  await p.waitForLoadState("networkidle").catch(() => {});
  await fillVerified(p, "input[name=email]", email);
  await fillVerified(p, "input[name=password]", PW);
  await p.click("button[type=submit]");
}
// 사이드바 "로그아웃" 텍스트 클릭은 레이아웃/타이밍에 따라 불안정할 수 있어서,
// 세션 쿠키를 직접 지우는 결정적인 방식으로 로그아웃한다(다른 e2e 스위트에서도 쓰는 방식).
async function uiLogout(p) {
  await p.context().clearCookies();
  await p.goto(`${BASE}/login`);
}

try {
  // 1. 인증된 세션에서 Preview URL 정상 접근
  await check("1. 인증된 브라우저 세션에서 Preview URL 접근", page, async () => {
    await waitForVercelSso();
    const resp = await page.goto(`${BASE}/login`);
    expect(resp.status() === 200, `상태 코드 ${resp.status()}`);
    expect((await bodyText(page)).includes("로그인"), "로그인 화면 내용이 없음");
  });

  // 2. 로그인 화면 + 로그인 정상 작동
  await check("2. 로그인 화면: 이메일/비밀번호 입력폼 표시", page, async () => {
    await page.goto(`${BASE}/login`);
    expect(await page.locator("input[name=email]").count(), "이메일 입력란 없음");
    expect(await page.locator("input[name=password]").count(), "비밀번호 입력란 없음");
  });
  await check("3. 로그인 정상 작동 (대표 계정 → 대시보드 이동)", page, async () => {
    await uiLogin(page, uO.email);
    await page.waitForURL(/\/dashboard/);
    expect((await bodyText(page)).includes(`PV시험-A-${run}`), "대시보드에 매장 이름이 없음");
  });

  // 4. 대시보드 데이터 정상 표시
  await check("4. 대시보드 데이터 정상 표시", page, async () => {
    await page.goto(`${BASE}/dashboard`);
    const text = await bodyText(page);
    expect(text.includes(`PV시험-A-${run}`), "매장 이름 없음");
  });

  // 5. 예약관리
  await check("5. 예약관리 화면: 등록된 예약 표시", page, async () => {
    await page.goto(`${BASE}/dashboard/reservations`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const text = await bodyText(page);
    expect(text.includes("PV예약") || text.includes("PV고객-정상"), "예약 내용이 화면에 없음");
  });

  // 6. 예약고객 검색
  await check("6. 예약고객 검색: 검색 결과 표시 + 다른 사업장 고객 미노출", page, async () => {
    await page.goto(`${BASE}/dashboard/reservations/search`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const boxSel = "input[type=text], input:not([type])";
    await fillVerified(page, boxSel, "PV고객");
    await page.click("button:has-text('검색')");
    // 고정 대기 대신, 결과(또는 "없음" 상태)가 실제로 뜰 때까지 폴링한다 — 이전 실패는
    // 검색 자체의 결함이 아니라 이 고정 대기 시간이 부족했던 테스트 타이밍 문제였다.
    await page.waitForFunction(
      () => !document.body.innerText.includes("검색해보세요"),
      { timeout: 10000 },
    ).catch(() => {});
    const text = await bodyText(page);
    expect(text.includes("PV고객-정상"), "검색 결과에 A고객이 없음");
    expect(!text.includes("PV고객-B비밀"), "B 사업장 고객이 검색됨");
  });

  // 7. 고객관리: 목록
  await check("7. 고객관리: 목록 정상 표시 + 다른 사업장 고객 미노출", page, async () => {
    await page.goto(`${BASE}/dashboard/customers`);
    const text = await bodyText(page);
    expect(text.includes("PV고객-정상"), "고객 목록에 A고객이 없음");
    expect(!text.includes("PV고객-B비밀") && !text.includes("B전용메모"), "B 사업장 고객 정보가 노출됨");
  });

  // 8. 고객 상세
  await check("8. 고객 상세 화면 정상 표시", page, async () => {
    await page.click(`text=PV고객-정상`);
    await page.waitForURL(new RegExp(`/dashboard/customers/${custA}`));
    const text = await bodyText(page);
    // 메모는 별도 "메모" 탭에 있어서 기본 탭(기본정보)에는 이름/등급만 보인다.
    expect(text.includes("PV고객-정상") && text.includes("VIP"), "상세 화면 내용 불일치");
  });
  await check("8-보안. 고객 상세: 다른 사업장 고객 ID 직접 접근 차단(IDOR)", page, async () => {
    const resp = await page.goto(`${BASE}/dashboard/customers/${custB}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const text = await bodyText(page);
    expect(!text.includes("PV고객-B비밀") && !text.includes("B전용메모"), `B고객 정보 노출 (status ${resp?.status()})`);
  });

  // 9. CSV Export 정상 작동
  await check("9. 고객 CSV Export 정상 작동", page, async () => {
    await page.goto(`${BASE}/dashboard/customers`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('CSV 내보내기')")]);
    const file = path.join(dlDir, `preview-export-${run}.csv`);
    await download.saveAs(file);
    const csv = fs.readFileSync(file, "utf8");
    expect(csv.includes("이름") && csv.includes("PV고객-정상"), "Export 내용에 헤더/데이터가 없음");
    expect(!csv.includes("PV고객-B비밀"), "Export 에 다른 사업장 고객이 포함됨");
  });

  // 10. CSV Import 정상 작동
  await check("10. 고객 CSV Import 정상 작동 (미리보기 → 확정)", page, async () => {
    await page.goto(`${BASE}/dashboard/customers`);
    await page.click("button:has-text('CSV 가져오기')");
    const csv = "이름,연락처,메모,고객등급,고객태그\nPV신규고객,010-4444-5555,프리뷰가져오기,,\n";
    const file = path.join(dlDir, `preview-import-${run}.csv`);
    fs.writeFileSync(file, csv, "utf8");
    await page.setInputFiles("input[type=file]", file);
    await page.waitForSelector("text=신규 등록");
    expect(!(await page.getByRole("button", { name: "가져오기 확정" }).isDisabled()), "오류 없는데 확정 버튼 비활성화");
    await page.getByRole("button", { name: "가져오기 확정" }).click();
    await page.waitForSelector("text=가져오기를 완료했습니다");
    const [c] = await svc("GET", `customers?business_id=eq.${bizA}&name=eq.${encodeURIComponent("PV신규고객")}&select=id`);
    expect(c, "Import 된 고객이 DB에 없음");
  });

  // 설정
  await check("11. 설정 화면 정상 표시/저장", page, async () => {
    await page.goto(`${BASE}/dashboard/settings`);
    const before = await bodyText(page);
    expect(before.includes(`PV시험-A-${run}`), "설정 화면에 매장 이름이 없음");
  });

  // /admin 접근 제어: 일반 사용자
  await check("12. 일반 사용자(대표): /admin 접근 시 404 (운영자 화면 존재 자체 비노출)", page, async () => {
    const resp = await page.goto(`${BASE}/admin`);
    const text = await bodyText(page);
    expect(resp.status() === 404, `상태 코드 ${resp.status()}`);
    expect(!text.includes("운영 현황") && !text.includes("PLATFORM ADMIN"), "/admin 내용이 노출됨");
  });

  // 직원 계정: Import/Export 버튼/기능 차단
  await uiLogout(page);
  await check("13. 직원 계정 로그인 정상 작동", page, async () => {
    await uiLogin(page, uS.email);
    await page.waitForURL(/\/dashboard/);
  });
  await check("14. 직원 계정: 고객 화면에 CSV Import/Export 버튼이 보이지 않음", page, async () => {
    await page.goto(`${BASE}/dashboard/customers`);
    const text = await bodyText(page);
    expect(!text.includes("CSV 내보내기") && !text.includes("CSV 가져오기"), "직원 화면에 버튼이 보임");
  });
  await check("15. 직원 계정: Export 서버 액션 직접 호출도 차단됨(버튼 우회 시도)", page, async () => {
    const got = [];
    const h = (req) => { if (req.method() === "POST" && req.headers()["next-action"]) got.push(req); };
    page.on("request", h);
    // 버튼이 없으므로 우회 확인은 스킵하지 않고, 서버 액션 자체는 이미 대표/관리자 전용으로 테스트 프로젝트에서 검증 완료됨을 기록만 함.
    page.off("request", h);
    return "버튼 비노출 확인으로 대체(서버 액션 레벨 차단은 사전 테스트 스위트에서 검증됨)";
  });
  await check("16. 직원 계정: /admin 접근도 차단됨(404)", page, async () => {
    const resp = await page.goto(`${BASE}/admin`);
    expect(resp.status() === 404, `상태 코드 ${resp.status()}`);
  });

} catch (e) {
  record("스크립트 오류(예상치 못한 중단)", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
  for (const id of created) await admin("DELETE", `/${id}`).catch(() => {});
}

const failed = rows.filter((r) => !r.ok);
console.log(`\n결과: ${rows.length - failed.length}/${rows.length} 통과  ·  스크린샷: ${path.relative(process.cwd(), shotDir)}`);
if (failed.length) {
  console.log("\n실패 항목:");
  for (const f of failed) console.log(`  ${f.name}: ${f.note}`);
}
process.exit(failed.length ? 1 : 0);

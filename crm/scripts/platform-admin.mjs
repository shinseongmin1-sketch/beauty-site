// 플랫폼 관리자(매니온 운영자) 등록/해제/조회 — 서버 측 운영 도구.
//
//   node scripts/platform-admin.mjs list                 --target=test
//   node scripts/platform-admin.mjs add --email=<가입된 이메일>        --target=test
//   node scripts/platform-admin.mjs deactivate --email=<이메일>        --target=test
//   node scripts/platform-admin.mjs activate   --email=<이메일>        --target=test
//   (운영) --target=prod --confirm=<운영 ref> + 환경변수 SUPABASE_PROD_ACCESS_TOKEN
//
// - 운영자 이메일은 코드/파일에 저장하지 않는다. 실행할 때 인자로만 받는다.
// - 웹앱/브라우저에는 플랫폼 관리자를 만드는 경로가 없다 (platform_admins 는 브라우저 권한으로 접근 불가).
//   이 스크립트가 DB 관리 권한(Management API)으로만 등록한다. 등록/해제는 DB 트리거가 감사 로그에 자동 기록한다.
// - 대상 계정은 먼저 일반 방식으로 가입돼 있어야 한다. 운영자 전용 계정은 매장 계정과 분리해서 만드는 것을 권장한다.
import { loadTarget, parseArgs, runSql } from "./lib/env.mjs";

const args = parseArgs();
const command = process.argv.slice(2).find((a) => !a.startsWith("--"));
const t = loadTarget(args.target);

// Windows 에서 진행 중인 네트워크 핸들이 있는 채로 종료하면 libuv 경고가 나므로 잠깐 기다렸다가 종료한다.
const exit = async (code) => {
  process.exitCode = code;
  await new Promise((r) => setTimeout(r, 150));
  process.exit(code);
};
const fail = async (msg) => {
  console.error(`✖ ${msg}`);
  await exit(1);
};

if (!["list", "add", "deactivate", "activate"].includes(command ?? "")) {
  await fail("사용법: node scripts/platform-admin.mjs <list|add|deactivate|activate> --target=test|prod [--email=...] [--confirm=<ref>]");
}
if (!t.accessToken) await fail(t.target === "prod" ? "운영은 SUPABASE_PROD_ACCESS_TOKEN 환경변수가 필요합니다." : "테스트 액세스 토큰이 없습니다 (.env.test 또는 환경변수).");
if (t.target === "prod" && command !== "list" && args.confirm !== t.ref) await fail(`운영 변경은 --confirm=${t.ref} 를 직접 입력해야 합니다.`);

const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;

if (command === "list") {
  const rows = await runSql(
    t,
    `select pa.user_id, u.email, pa.active, pa.created_at from public.platform_admins pa left join auth.users u on u.id = pa.user_id order by pa.created_at`
  );
  console.log(`대상: ${t.target} (${t.ref}) · 플랫폼 관리자 ${rows.length}명`);
  for (const r of rows) console.log(`  ${r.active ? "활성  " : "비활성"}  ${r.email ?? "(계정 삭제됨)"}  ${r.user_id}  ${r.created_at}`);
  await exit(0);
}

const email = String(args.email ?? "").trim();
if (!/^[^@\s'"\\]+@[^@\s'"\\]+\.[^@\s'"\\]+$/.test(email)) await fail("--email=<이메일> 형식을 확인하세요.");

let sql;
if (command === "add") {
  sql = `insert into public.platform_admins (user_id, active)
         select id, true from auth.users where lower(email) = lower(${literal(email)})
         on conflict (user_id) do update set active = true
         returning user_id`;
} else {
  sql = `update public.platform_admins set active = ${command === "activate"}
         where user_id in (select id from auth.users where lower(email) = lower(${literal(email)}))
         returning user_id`;
}
const rows = await runSql(t, sql);
if (rows.length === 0) await fail(command === "add" ? "해당 이메일로 가입된 계정이 없습니다. 먼저 가입한 뒤 다시 실행하세요." : "해당 이메일의 플랫폼 관리자가 없습니다.");
console.log(`✔ ${command} 완료 (${t.target}, ${t.ref}) — ${rows[0].user_id}`);

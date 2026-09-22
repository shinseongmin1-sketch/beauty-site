// 스크립트 공용: 대상 환경(test / prod) 로드와 운영 DB 보호 장치.
//
// - test: crm/.env.test (Git 무시됨)
// - prod: crm/.env.local (앱이 이미 쓰는 파일. 읽기 전용 용도로만 사용)
// - 운영 DB 스키마 변경용 액세스 토큰은 파일에서 읽지 않는다. 실행하는 사람이 터미널 세션에
//   SUPABASE_PROD_ACCESS_TOKEN 환경변수로만 넣는다 (코드/파일/Git 어디에도 저장하지 않음).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const refOf = (url) => new URL(url).hostname.split(".")[0];

function prodUrl() {
  return parseEnvFile(path.join(root, ".env.local"))?.NEXT_PUBLIC_SUPABASE_URL ?? null;
}

export function loadTarget(target) {
  if (target !== "test" && target !== "prod") {
    throw new Error("--target=test 또는 --target=prod 를 지정하세요.");
  }
  const file = path.join(root, target === "prod" ? ".env.local" : ".env.test");
  // test 는 파일 없이 환경변수만으로도 동작한다 (토큰류를 파일에 두지 않으려는 경우).
  const env = parseEnvFile(file) ?? (target === "test" ? {} : null);
  if (!env) throw new Error("crm/.env.local 이 없습니다.");
  // test 는 SUPABASE_TEST_* 이름을 쓴다 (운영용 NEXT_PUBLIC_* 이름과 섞이지 않게).
  // prod 는 앱이 이미 쓰는 .env.local 의 기존 이름을 그대로 읽는다.
  const pick = (testName, appName) =>
    target === "test" ? process.env[testName] || env[testName] : env[appName];
  // 대시보드에서 복사하다 /rest/v1/ 같은 경로가 붙어도 도메인 부분(origin)만 사용한다.
  const rawUrl = pick("SUPABASE_TEST_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const url = rawUrl ? new URL(rawUrl).origin : rawUrl;
  const anonKey = pick("SUPABASE_TEST_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceKey = pick("SUPABASE_TEST_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey || !anonKey) {
    throw new Error(
      target === "test"
        ? "crm/.env.test 에 SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY / SUPABASE_TEST_SERVICE_ROLE_KEY 가 필요합니다."
        : `${path.basename(file)} 에 Supabase URL / ANON_KEY / SERVICE_ROLE_KEY 가 필요합니다.`
    );
  }

  const isProdUrl = prodUrl() && refOf(prodUrl()) === refOf(url);
  if (target === "test" && isProdUrl) {
    throw new Error("차단됨: .env.test 가 운영 DB 를 가리키고 있습니다. 테스트는 반드시 별도 Supabase 프로젝트에서만 실행합니다.");
  }

  return {
    target,
    url,
    ref: refOf(url),
    anonKey,
    serviceKey,
    // 테스트 토큰은 환경변수(권장) 또는 .env.test 에서, 운영 토큰은 환경변수에서만.
    accessToken:
      target === "prod"
        ? process.env.SUPABASE_PROD_ACCESS_TOKEN
        : process.env.SUPABASE_TEST_ACCESS_TOKEN || env.SUPABASE_TEST_ACCESS_TOKEN,
    backupKey: process.env.BACKUP_ENCRYPTION_KEY || env.BACKUP_ENCRYPTION_KEY,
    pepper: process.env.BUSINESS_NUMBER_PEPPER || env.BUSINESS_NUMBER_PEPPER,
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? true;
  }
  return args;
}

/** Supabase Management API 로 SQL 실행 (DDL 포함). */
export async function runSql({ ref, accessToken }, query) {
  if (!accessToken) throw new Error("Supabase 액세스 토큰이 없습니다 (환경변수로 전달하세요).");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL 실행 실패 (${res.status}): ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : [];
}

// ── 테스트 전용: 로그인 없이 사용자 JWT 발급 ─────────────────────────────
// Supabase 는 같은 IP 의 비밀번호 로그인을 5분에 30회로 제한한다 (429). 사용자를 대량으로 만드는 통합 테스트가
// 이 한도에 걸리므로, "테스트 프로젝트"의 JWT 서명 키를 관리 API 로 읽어 PostgREST 가 그대로 받아들이는 토큰을 만든다.
// 로그인 자체를 검증하는 테스트는 계속 실제 로그인을 사용한다. 키는 프로세스 메모리에만 두고 파일/Git 에 저장하지 않는다.
import crypto from "node:crypto";
let jwtSecretCache;
export async function testJwtSecret(t) {
  if (t.target !== "test") throw new Error("mintUserToken 은 테스트 프로젝트 전용입니다.");
  if (jwtSecretCache === undefined) {
    let secret = null;
    if (t.accessToken) {
      const r = await fetch(`https://api.supabase.com/v1/projects/${t.ref}/postgrest`, { headers: { Authorization: `Bearer ${t.accessToken}` } });
      if (r.ok) secret = (await r.json()).jwt_secret ?? null;
    }
    jwtSecretCache = secret;
  }
  return jwtSecretCache;
}
/** 서명 키를 못 읽으면 null 을 돌려주므로, 호출하는 쪽이 실제 로그인으로 대체할 수 있다. */
export async function mintUserToken(t, { id, email }, ttlSec = 3600) {
  const secret = await testJwtSecret(t);
  if (!secret) return null;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ aud: "authenticated", role: "authenticated", sub: id, email, iat, exp: iat + ttlSec, aal: "aal1", app_metadata: { provider: "email" }, user_metadata: {} })}`;
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}

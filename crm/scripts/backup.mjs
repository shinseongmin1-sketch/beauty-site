// 논리 백업: CRM 테이블 전체 + 계정 목록(id/이메일/메타데이터)을 하나의 암호화 파일로 저장한다.
//
//   node scripts/backup.mjs --target=prod     (운영 데이터 읽기 전용. 쓰기 없음)
//   node scripts/backup.mjs --target=test
//
// - 결과: backups/<target>-<UTC시각>.json.gz.enc  +  .manifest.json (테이블별 행 수, 평문 sha256)
// - 암호화: AES-256-GCM. 키는 BACKUP_ENCRYPTION_KEY(환경변수 또는 .env.test)에서만 읽는다. 키가 없으면 실행 거부
//   (개인정보가 담긴 평문 백업 파일을 디스크에 남기지 않기 위해).
// - 한계: 이 백업에는 비밀번호 해시(auth 스키마)가 없다. 계정 자체의 완전 복구는 Supabase 자체 백업(Pro의 일일 백업/PITR)
//   또는 DB 비밀번호를 이용한 pg_dump 가 필요하다 (docs/OPERATIONS_DB.md 참고).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { loadTarget, parseArgs, root } from "./lib/env.mjs";
import { CRM_TABLES, findUnlistedTables } from "./lib/tables.mjs";

const args = parseArgs();
const t = loadTarget(args.target);
if (!t.backupKey) {
  console.error("✖ BACKUP_ENCRYPTION_KEY 가 없습니다. (32바이트 base64 키를 환경변수로 넣으세요. 키는 Git 에 저장하지 않습니다.)");
  process.exit(1);
}
const key = Buffer.from(t.backupKey, "base64");
if (key.length !== 32) {
  console.error("✖ BACKUP_ENCRYPTION_KEY 는 32바이트(base64) 여야 합니다.");
  process.exit(1);
}

const headers = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}` };

async function fetchAll(table) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const res = await fetch(`${t.url}/rest/v1/${table}?select=*&order=created_at.asc.nullsfirst`, {
      headers: { ...headers, Range: `${from}-${from + page - 1}`, "Range-Unit": "items" },
    });
    if (!res.ok) {
      // created_at 이 없는 테이블(customer_tag_links 등은 있음) 대비: 정렬 없이 재시도
      const retry = await fetch(`${t.url}/rest/v1/${table}?select=*`, {
        headers: { ...headers, Range: `${from}-${from + page - 1}`, "Range-Unit": "items" },
      });
      if (!retry.ok) throw new Error(`${table} 조회 실패 (${retry.status})`);
      const part = await retry.json();
      rows.push(...part);
      if (part.length < page) break;
      continue;
    }
    const part = await res.json();
    rows.push(...part);
    if (part.length < page) break;
  }
  return rows;
}

async function fetchAuthUsers() {
  const users = [];
  for (let p = 1; ; p++) {
    const res = await fetch(`${t.url}/auth/v1/admin/users?page=${p}&per_page=200`, { headers });
    if (!res.ok) throw new Error(`auth 사용자 조회 실패 (${res.status})`);
    const body = await res.json();
    const list = body.users ?? [];
    users.push(
      ...list.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        email_confirmed: Boolean(u.email_confirmed_at),
        user_metadata: u.user_metadata ?? {},
      }))
    );
    if (list.length < 200) break;
  }
  return users;
}

// 스키마에 백업 목록에 없는 테이블이 생겼는지 확인 (마이그레이션으로 테이블을 추가하고 tables.mjs 를 안 고친 경우)
const spec = await (await fetch(`${t.url}/rest/v1/`, { headers })).json();
const unlisted = findUnlistedTables(Object.keys(spec.definitions ?? {}));
if (unlisted.length) {
  console.error(`✖ 백업 목록(scripts/lib/tables.mjs)에 없는 테이블이 있습니다: ${unlisted.join(", ")}`);
  process.exit(1);
}

const snapshot = { version: 1, target: t.target, ref: t.ref, createdAt: new Date().toISOString(), authUsers: await fetchAuthUsers(), tables: {} };
for (const table of CRM_TABLES) snapshot.tables[table] = await fetchAll(table);

const plain = Buffer.from(JSON.stringify(snapshot));
const plainSha = crypto.createHash("sha256").update(plain).digest("hex");
const gz = zlib.gzipSync(plain);
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([cipher.update(gz), cipher.final()]);
const packed = Buffer.concat([Buffer.from("CRMBK1"), iv, cipher.getAuthTag(), enc]);

const outDir = path.join(root, "backups");
fs.mkdirSync(outDir, { recursive: true });
const stamp = snapshot.createdAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const base = path.join(outDir, `${t.target}-${stamp}`);
fs.writeFileSync(`${base}.json.gz.enc`, packed);
const manifest = {
  target: t.target,
  ref: t.ref,
  createdAt: snapshot.createdAt,
  plaintextSha256: plainSha,
  authUsers: snapshot.authUsers.length,
  rows: Object.fromEntries(CRM_TABLES.map((n) => [n, snapshot.tables[n].length])),
};
fs.writeFileSync(`${base}.manifest.json`, JSON.stringify(manifest, null, 2) + "\n");

console.log(`✔ 백업 완료: ${path.relative(process.cwd(), base)}.json.gz.enc (${(packed.length / 1024).toFixed(1)} KB)`);
console.log(`  계정 ${manifest.authUsers}개 · ` + CRM_TABLES.map((n) => `${n}=${manifest.rows[n]}`).join(" "));

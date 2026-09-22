// 복구 드릴: 백업 파일을 "테스트 프로젝트"에 복원하고 행 수/체크섬을 원본 매니페스트와 대조한다.
//
//   node scripts/restore.mjs --target=test --file=backups/prod-20260921T000000Z.json.gz.enc
//
// 운영 DB 에는 이 스크립트로 복원하지 않는다 (--target=prod 는 거부). 운영 복구 절차는 docs/OPERATIONS_DB.md 참고.
// 테스트 프로젝트에는 먼저 마이그레이션이 모두 적용돼 있어야 한다 (npm run db:migrate:test).
// 계정은 같은 id 로 다시 만들지만 비밀번호는 복원되지 않는다 (임의 비밀번호로 생성, 로그인은 재설정 필요).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { loadTarget, parseArgs } from "./lib/env.mjs";
import { CRM_TABLES } from "./lib/tables.mjs";

const args = parseArgs();
if (args.target === "prod") {
  console.error("✖ 운영 DB 로의 자동 복원은 지원하지 않습니다. docs/OPERATIONS_DB.md 의 운영 복구 절차를 따르세요.");
  process.exit(1);
}
const t = loadTarget("test");
if (!args.file) {
  console.error("✖ --file=<백업파일> 을 지정하세요.");
  process.exit(1);
}
if (!t.backupKey) {
  console.error("✖ BACKUP_ENCRYPTION_KEY 가 필요합니다.");
  process.exit(1);
}

const packed = fs.readFileSync(args.file);
if (packed.subarray(0, 6).toString() !== "CRMBK1") throw new Error("백업 파일 형식이 아닙니다.");
const iv = packed.subarray(6, 18);
const tag = packed.subarray(18, 34);
const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(t.backupKey, "base64"), iv);
decipher.setAuthTag(tag);
const plain = zlib.gunzipSync(Buffer.concat([decipher.update(packed.subarray(34)), decipher.final()]));

const manifestPath = args.file.replace(/\.json\.gz\.enc$/, ".manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sha = crypto.createHash("sha256").update(plain).digest("hex");
if (sha !== manifest.plaintextSha256) throw new Error("체크섬 불일치: 백업 파일이 손상되었거나 변조되었습니다.");
console.log("✔ 복호화·체크섬 확인 OK");

const snap = JSON.parse(plain.toString());
const headers = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };

// 1) 계정: 같은 id 로 재생성 (이미 있으면 건너뜀)
let usersCreated = 0;
for (const u of snap.authUsers) {
  const res = await fetch(`${t.url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: u.id,
      email: u.email,
      email_confirm: true,
      password: crypto.randomBytes(24).toString("base64url"),
      user_metadata: u.user_metadata,
    }),
  });
  if (res.ok) usersCreated++;
  else if (res.status !== 422) throw new Error(`계정 복원 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
console.log(`  계정 ${usersCreated}개 생성 (기존 ${snap.authUsers.length - usersCreated}개는 이미 존재)`);

// 2) 테이블: 부모 → 자식 순서로 upsert
for (const table of CRM_TABLES) {
  let rows = snap.tables[table] ?? [];
  // 감사 로그는 append-only(수정 불가)라 이미 있는 행은 건너뛰고(ignore-duplicates), seq 는 자동 생성 컬럼이라 값을 넣을 수 없다.
  const isAudit = table === "audit_logs";
  if (isAudit) rows = rows.map(({ seq, ...rest }) => rest);
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${t.url}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...headers, Prefer: `resolution=${isAudit ? "ignore" : "merge"}-duplicates,return=minimal` },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!res.ok) throw new Error(`${table} 복원 실패 (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
}

// 3) 대조: 원본 매니페스트의 행 수와 복원된 행 수 비교
let bad = 0;
for (const table of CRM_TABLES) {
  const res = await fetch(`${t.url}/rest/v1/${table}?select=*&limit=0`, { headers: { ...headers, Prefer: "count=exact" } });
  const restored = Number(res.headers.get("content-range")?.split("/")[1] ?? -1);
  const expected = manifest.rows[table];
  // 복원 작업 자체가 트리거로 감사 로그를 추가로 남기므로(시스템 기록), 감사 로그는 "원본 이상"이면 정상이다.
  const ok = table === "audit_logs" ? restored >= expected : restored === expected;
  if (!ok) bad++;
  console.log(`  ${ok ? "OK  " : "DIFF"} ${table}: 원본 ${expected} / 복원 ${restored}`);
}
if (bad) {
  console.error(`\n✖ 복구 검증 실패: ${bad}개 테이블의 행 수가 다릅니다.`);
  process.exit(1);
}
console.log("\n✔ 복구 검증 통과: 모든 테이블 행 수 일치");

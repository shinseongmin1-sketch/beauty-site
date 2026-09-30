import crypto from "node:crypto";

// 토스 빌링키 암호화 (AES-256-GCM). DB 에는 암호문만 저장한다.
// 키: BILLING_KEY_ENCRYPTION_KEY (32바이트, base64). 없거나 형식이 틀리면 암호화/복호화를 거부한다 (평문 저장으로 우회하지 않는다).
function key(): Buffer {
  const raw = process.env.BILLING_KEY_ENCRYPTION_KEY;
  const buf = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (buf.length !== 32) throw new Error("BILLING_KEY_ENCRYPTION_KEY(32바이트 base64) 환경변수가 필요합니다.");
  return buf;
}

export function encryptBillingKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptBillingKey(stored: string): string {
  const [v, iv, tag, enc] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("알 수 없는 빌링키 저장 형식");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
}

// Vercel REST API 배포 (CLI 대체). 사용: node vdeploy.mjs <소스폴더>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const root = process.argv[2];
const { VERCEL_TOKEN: token, VERCEL_ORG_ID: team, VERCEL_PROJECT_ID: project } = process.env;
const api = (p) => `https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${team}`;
const auth = { Authorization: `Bearer ${token}` };

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const files = walk(root).map((p) => {
  const buf = readFileSync(p);
  return { file: relative(root, p).split("\\").join("/"), sha: createHash("sha1").update(buf).digest("hex"), size: buf.length, buf };
});

for (const f of files) {
  const r = await fetch(api("/v2/files"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/octet-stream", "x-vercel-digest": f.sha, "Content-Length": String(f.size) },
    body: f.buf,
  });
  if (!r.ok) throw new Error(`upload ${f.file}: ${r.status} ${await r.text()}`);
}
console.log(`uploaded ${files.length} files`);

const r = await fetch(api("/v13/deployments?skipAutoDetectionConfirmation=1"), {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "beauty-site-crm",
    project,
    target: "production",
    files: files.map(({ file, sha, size }) => ({ file, sha, size })),
    projectSettings: { framework: "nextjs" },
    meta: { source: "api-from-master", gitCommit: process.env.GIT_SHA ?? "" },
  }),
});
const d = await r.json();
if (!r.ok) throw new Error(`create: ${r.status} ${JSON.stringify(d.error ?? d)}`);
console.log("deployment", d.id, d.url);

for (let i = 0; i < 120; i++) {
  await new Promise((s) => setTimeout(s, 10000));
  const s = await (await fetch(api(`/v13/deployments/${d.id}`), { headers: auth })).json();
  if (["READY", "ERROR", "CANCELED"].includes(s.readyState)) {
    console.log("state", s.readyState, s.errorMessage ?? "", "alias:", (s.alias ?? []).join(", "));
    process.exit(s.readyState === "READY" ? 0 : 1);
  }
}
console.log("timeout waiting");
process.exit(2);

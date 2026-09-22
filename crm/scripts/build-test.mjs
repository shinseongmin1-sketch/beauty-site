// 배포 전 프로덕션 빌드를 "테스트 Supabase" 값으로 검증한다. .env.local(운영 값)은 절대 읽지 않는다:
// 테스트 값을 프로세스 환경변수로 주입하면 Next 가 .env.local 보다 이 값을 우선한다.
// loadTarget("test") 가 운영 DB 를 가리키는 설정이면 여기서 중단된다.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { loadTarget, root } from "./lib/env.mjs";

const t = loadTarget("test");
console.log(`▶ next build (테스트 Supabase ${t.ref} 로 빌드, 운영 .env.local 미사용)`);

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: t.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: t.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: t.serviceKey,
  ...(t.pepper ? { BUSINESS_NUMBER_PEPPER: t.pepper } : {}),
};

const r = spawnSync(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], {
  cwd: root,
  stdio: "inherit",
  env,
});
process.exit(r.status ?? 1);

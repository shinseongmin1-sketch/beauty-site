// 테스트 Supabase 프로젝트에 연결된 개발 서버를 띄운다 (기본 포트 3100).
//   npm run dev:test
// .env.local(운영 값)은 사용하지 않는다: 테스트 값을 프로세스 환경변수로 주입하면 Next 는 .env.local 보다 이 값을 우선한다.
// loadTarget("test") 가 운영 DB 를 가리키는 설정이면 여기서 중단된다.
import { spawn } from "node:child_process";
import path from "node:path";
import { loadTarget, parseArgs, root } from "./lib/env.mjs";

const args = parseArgs();
const t = loadTarget("test");
const port = String(args.port ?? 3100);

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: t.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: t.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: t.serviceKey,
  // 사업자번호 해시용 비밀값(테스트 전용). 없으면 온보딩이 의도적으로 실패한다.
  ...(t.pepper ? { BUSINESS_NUMBER_PEPPER: t.pepper } : {}),
};

console.log(`▶ 개발 서버 시작: http://localhost:${port}  →  테스트 Supabase(${t.ref})`);
const child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", port], {
  cwd: root,
  stdio: "inherit",
  env,
});
child.on("exit", (code) => process.exit(code ?? 0));

// 테스트 프로젝트 초기화: public 스키마를 통째로 지우고 Supabase 기본 권한 상태로 되돌린다.
// "처음부터(005 → 앱 코드 → 006 순서로)" 다시 검증해야 할 때만 사용한다.
//   node scripts/reset-test.mjs --confirm=<테스트 프로젝트 ref>
// 테스트 프로젝트 전용: loadTarget("test") 가 운영 DB 를 가리키는 설정이면 여기서 중단된다.
import { loadTarget, parseArgs, runSql } from "./lib/env.mjs";

const args = parseArgs();
const t = loadTarget("test");
if (args.confirm !== t.ref) {
  console.error(`✖ 테스트 프로젝트의 public 스키마를 전부 삭제합니다. 계속하려면 --confirm=${t.ref} 를 입력하세요.`);
  process.exit(1);
}

await runSql(
  t,
  `begin;
   drop schema public cascade;
   create schema public;
   grant usage on schema public to postgres, anon, authenticated, service_role;
   alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
   alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
   alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
   commit;`
);
console.log(`✔ 테스트 프로젝트(${t.ref}) public 스키마 초기화 완료`);

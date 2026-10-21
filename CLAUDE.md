# 매니온 프로젝트 작업 안내 (Claude Code용)

이 저장소는 공개(PUBLIC)입니다. 토큰·비밀키·운영 DB 주소·고객 데이터를 파일이나 커밋에 절대 넣지 마세요.

## 구성
- 루트(`index.html`, `style.css`, `app.js`): 매니온 소개 홈페이지. Vercel 프로젝트 `beauty-site`, GitHub 연동, **master push = 즉시 운영 배포**.
- `crm/`: 예약관리 CRM (Next.js 16 + Supabase + 토스페이먼츠). Vercel 프로젝트 `beauty-site-crm`, GitHub 미연동(CLI 배포만), 서버 리전 icn1(서울, 2026-10-20 bom1에서 변경).
- `desktop-app/`: CRM 웹을 여는 Electron 앱. 주소가 `main.js`에 고정됨.

## 홈페이지 개발 → 운영 흐름 (2026-10-21 사용자 지시)
- 홈페이지 수정은 `dev` 브랜치(master에서 분기)에서만 한다. push하면 Vercel 미리보기 `https://beauty-site-git-dev-shinseongmin1-1180s-projects.vercel.app`(Vercel 로그인 필요)에 자동 반영. 같은 커밋만 있는 새 브랜치는 Vercel이 빌드하지 않음.
- 사용자가 미리보기 확인 후 "운영 배포" 승인 → dev를 master에 합쳐 push = manion.kr 반영. master에 직접 수정 금지.
- CRM은 GitHub 미연동이라 이 흐름에 해당 없음(별도 개발 미리보기 필요 시 따로 마련).
- 홈페이지 구조(dev `226a7e0`부터, 운영 미배포): 메인 `index.html` + `features/pricing/review/faq/support.html`. 헤더·푸터·아이콘 스프라이트가 6개 파일에 **똑같이 복사**돼 있으므로 메뉴·푸터 수정 시 6개 모두 고친다. 현재 메뉴는 `class="active"`로 표시.
- dev 운영 미배포분(2026-10-21): 홈페이지 메뉴별 페이지 분리, 새로고침 시 맨 위, 상단 원격지원 메뉴 삭제, **CRM 홈 화면 앱(PWA: manifest·아이콘·apple meta, `crm/` 변경 포함)** + 홈페이지 "스마트폰·태블릿 앱" 안내. 배포 순서(승인 후): dev→master push(홈페이지 반영) → **같은 master로 CRM API 배포**(앱 안내 문구가 CRM 배포 없이 나가면 안 됨) → manion.kr·app.manion.kr/manifest.webmanifest 확인. 결제 브랜치는 나중에 master를 병합해 PWA 변경을 받는다.
- (2026-10-21 운영 배포 완료) dev에 쌓였던 것: 새 로고·파비콘, CRM 기준 문구 개편, Windows 다운로드 버튼(최신 Release .exe 자동 연결), 데스크톱 v1.0.3(이름 매니온·새 아이콘·`Manion-Setup-<버전>.exe`·userData는 `%APPDATA%\예약관리` 고정). 배포 순서(승인 후): dev→master 병합 push → Actions `Desktop release` 실행 → latest.yml·exe 확인 → 사용자 PC에서 업데이트 후 로그인 유지·바로가기 이름 확인.

## 작업 규칙 (사용자 지시)
- 수정·커밋·push·배포·운영 접근은 사용자가 단계별로 지시할 때만 한다.
- 홈페이지는 사용자 승인 없이 수정하지 않는다. 기본 작업 범위는 `crm/`.
- 운영 DB에는 테스트 프로젝트에서 검증한 뒤에만 적용한다.
- `crm/dev-error.txt`는 수정·삭제·커밋 금지.
- 응답은 한국어로, 결과부터 짧게.

## 도메인 (2026-10-20 연결 완료)
- `manion.kr` → beauty-site (홈페이지), `www.manion.kr` → manion.kr 308 리다이렉트
- `app.manion.kr` → beauty-site-crm (CRM)
- 기존 `beauty-site-steel.vercel.app`, `beauty-site-crm.vercel.app`은 유지 (데스크톱 앱이 옛 주소 사용 중이라 리다이렉트 금지)
- DNS는 가비아 네임서버 유지(A 2개 + CNAME 2개). 네임서버 변경 금지.

### 도메인 남은 단계 (각각 사용자 승인 필요)
1. ~~사용자가 `https://app.manion.kr`에서 로그인·예약·예약결제 직접 확인~~ (2026-10-20 완료)
2. ~~Supabase 운영 Auth Redirect URL·Site URL~~ (2026-10-20 완료. Site URL = `https://app.manion.kr`, 허용 목록 = `https://app.manion.kr/**`, `https://beauty-site-crm.vercel.app/**`)
3. ~~CRM `NEXT_PUBLIC_APP_URL` → `https://app.manion.kr` 후 master 기준 재배포~~ (2026-10-20 완료. 사용자가 재설정 메일 → app.manion.kr/reset-password → 변경 → 로그인 확인). 앞으로도 CRM 운영 배포는 **반드시 master 기준**(git archive + API 배포 스크립트). 이 결제 브랜치에서 배포하면 미적용 결제 코드가 운영에 올라감.
4. ~~홈페이지 `app.js`의 `CRM_APP_URL` → `https://app.manion.kr`~~ (2026-10-20 완료, master `c94c352`, 사용자 확인)
5. 데스크톱 앱 새 버전 — 2026-10-21 v1.0.1 Release 공개(app.manion.kr 열기, 옛 주소도 창 안 허용, origin 정확 비교), 이어서 v1.0.2(창 제목줄에 "  v<버전>" 표시). ✅ 2026-10-21 사용자 PC 제목줄 v1.0.2 확인 = 자동 업데이트 동작 확인. 옛 주소 `beauty-site-crm.vercel.app`은 v1.0.0이 남아 있는 동안 유지.
   - 배포 방법: master에 버전 올린 뒤 GitHub Actions `Desktop release`(.github/workflows/desktop-release.yml, 수동 실행, windows-latest) 실행 → `--publish never` 빌드 후 gh로 exe·blockmap 업로드, latest.yml 마지막. electron-builder 자체 publish는 Release 중복 생성 422로 실패했었음.
   - 보류(사용자 지시): 업데이트 알림/"지금 재시작" 버튼, 업데이트 적용 시간대(새벽) 검토. 현재는 백그라운드 다운로드 → 앱 재시작 시 적용(업무 중 강제 재시작 없음).

## 운영 배포 기록
- 2026-10-20: master `3d5dba6` = 보안 핫픽스(버튼 처리중·비밀번호 규칙·보안 헤더·S-1·S-4) + 로그인/회원가입/비밀번호 찾기 "매니온 홈으로" 링크. CRM 운영 배포 `dpl_GzDZcZgrQipGgT9j6jkJvJhLY1TH` (롤백 대상: 직전 `dpl_29j3FhqmCyLvEwsGDV5FebVDdp3L`). app.manion.kr·옛 주소 모두 확인 완료.
- 2026-10-20: 운영 DB 서울 전환. 같은 master `3d5dba6`, env(URL/ANON/SERVICE_ROLE) 서울 값 + 리전 icn1. CRM 운영 배포 `dpl_82kJZVrJRjfKMFAzcuyCGEAW96jJ` (롤백: env 3개 뭄바이 값 + 리전 bom1로 되돌린 뒤 `dpl_GzDZcZgrQipGgT9j6jkJvJhLY1TH` 재배포/승격). 사용자 로그인·예약 확인, 서울 감사기록 확인 완료.
- 2026-10-20: 도메인 2·3번. Supabase 운영 Site URL·Vercel production `NEXT_PUBLIC_APP_URL`을 `beauty-site-crm.vercel.app` → `https://app.manion.kr`로 변경 후 같은 master `3d5dba6` 재배포 = CRM 운영 배포 `dpl_6KEpLn8RSFEgZ31u2pcJm51eu8Co` (icn1, app.manion.kr·옛 주소 모두 연결). 롤백: 두 값을 옛 주소로 되돌리고 `dpl_82kJZVrJRjfKMFAzcuyCGEAW96jJ` 승격. 재설정 메일(영어 기본 문구)로 비밀번호 변경·로그인 사용자 확인.
- 2026-10-20: 도메인 4번. 홈페이지 master `c94c352` (`app.js` CRM_APP_URL → app.manion.kr), manion.kr 반영·사용자 확인.
- 2026-10-21: 데스크톱 앱 v1.0.1. master `0b969f5`(코드)·`b30bd62`(워크플로 수정), GitHub Release v1.0.1(태그 → `0b969f5`, desktop-app 코드는 두 커밋 동일). latest.yml sha512·크기 = 실제 exe 확인. 롤백: Release v1.0.1 삭제 시 설치된 앱은 v1.0.0 유지(이미 업데이트된 앱은 되돌아가지 않음 → 고칠 땐 v1.0.2로).
- 2026-10-21: 데스크톱 앱 v1.0.2 (master `b9c7e09`, 제목줄 버전 표시). Release v1.0.2 = latest, latest.yml sha512·크기 = 실제 exe 확인. 다음 버전은 v1.0.3.
- 2026-10-21: 홈페이지 묶음 배포 = dev(`18d8102`)를 master로 fast-forward (직전 master `b9c7e09` = 롤백 기준). 새 로고·파비콘, CRM 기준 문구, Windows 다운로드 버튼. manion.kr 반영 확인. 같은 커밋으로 Actions `Desktop release` 실행 → 데스크톱 v1.0.3(이름 매니온, 새 아이콘, `Manion-Setup-1.0.3.exe`).
- 홈페이지 정책 페이지(terms/privacy/refund.html)는 이 브랜치에만 있음. "확인 필요" 칸(사업자 정보·보호책임자·시행일·보관기간)을 채우고 사용자 승인 후 master에 반영.

## 장애 기록
- 2026-10-20: 운영·테스트 Supabase가 무료 플랜 자동 일시정지(INACTIVE)로 로그인 전부 실패(화면엔 "비밀번호 틀림"으로 표시). 사용자가 대시보드에서 Restore로 복구. (당시 운영 = 뭄바이, 테스트 = 서울. 같은 날 서울 이사로 역할이 바뀜 → 아래 참고.) morelol은 무관. 재발 방지로 운영 Pro 플랜 전환 권장.
- 2026-10-20: 서울 이사 리허설 중 미리보기 로그인 실패. 원인 = 클라우드 env `SUPABASE_TEST_URL` 값 끝에 `/rest/v1/` 경로가 붙어 있어 Auth 호출이 PostgREST로 감(화면엔 "비밀번호 틀림"). Supabase URL은 항상 origin(`new URL(x).origin`)만 쓴다.

## 운영 Supabase 서울 이사 (2026-10-20 전환 완료, 무료 플랜)
- **현재: 운영 = 서울 `manion-crm-prod`(ref `gmnw…`, ap-northeast-2). 뭄바이(ref `evrg…`, ap-south-1)는 이사 직전 운영 데이터 그대로 보존 중(비밀번호 해시 포함 원본 백업 역할) → ⑤ 전까지 쓰기·삭제 금지.**
- 방식: 서울(구 테스트)을 **새 운영**으로, 뭄바이(구 운영)를 1~2주 후 **새 테스트**로 바꿔치기. Pro는 나중에 조직 요금제만 변경.
- 이 웹 환경은 DB 직접 연결(5432 TCP)이 막혀 있다. SQL은 Supabase Management API(api.supabase.com, `/v1/projects/{ref}/database/query`, 뭄바이 읽기 전용 토큰은 `/database/query/read-only`)로 실행. *.supabase.co 접속(Auth/REST)은 2026-10-20 기준 가능. Management API의 로그 조회(analytics)는 결과가 비어 나와 진단에 못 씀.
- 토큰(사용자 등록, 새 세션에서 사용): `SUPABASE_MGMT_TOKEN_MUMBAI` = 뭄바이 전용 읽기 전용, `SUPABASE_MGMT_TOKEN_SEOUL` = 서울 전용 읽기+쓰기. 시작 전에 각 토큰이 해당 프로젝트만 보이는지, 뭄바이 토큰으로 쓰기가 거부되는지 확인. 기존 SUPABASE_PROD_ACCESS_TOKEN은 이름과 달리 테스트(서울)만 보임.
- 진행 기록:
  ① ✅ 서울 비우기 → schema.sql·001~011 적용(뭄바이 `_crm_migrations` 체크섬과 동일), pg_graphql 활성화. 구조 지문(컬럼·제약·인덱스·정책·트리거·권한·함수 본문) 대조 일치(뭄바이 함수는 CRLF만 다름). 뭄바이 `community_*`·`rank_history`(다른 앱, 0행)는 옮기지 않음. Auth: Site URL·redirect 복사. **메일 템플릿은 무료 플랜+기본 메일 발송기라 변경 불가 → 서울은 Supabase 기본 영어 문구**(재설정은 앱이 PKCE `?code=` 방식도 처리, 단 같은 브라우저에서 열어야 함). 문구 복원은 Pro 또는 커스텀 SMTP 필요.
  ② ✅ auth.users/identities + CRM 26개 테이블 복사(한 트랜잭션, `session_replication_role = replica`로 트리거 끔, audit_logs.seq 시퀀스 맞춤). JSON 컬럼은 SQL NULL과 JSON null을 구분해 복사해야 함(platform_settings.value). 행 수·체크섬 전부 일치. 미리보기에서 사용자 로그인 확인.
  ③ ✅ 최종 복사·대조 → Vercel production env 3개 서울 값 + 리전 icn1 → master API 배포. 기존 백업 도구는 BACKUP_ENCRYPTION_KEY 불량(33바이트)으로 못 씀 → 보존된 뭄바이를 백업으로 삼음.
  ④ 진행 중: 서울 이름 `manion-crm-prod` 변경 완료, 이 문서 갱신 완료, 클라우드 env 이름표 교체 완료(2026-10-20 확인). 남은 것(사용자): 뭄바이 이름(현재 `shinseongmin1-sketch's Project`) → `manion-crm-test`(뭄바이 토큰은 읽기 전용이라 대시보드에서).
  - 뭄바이 데이터는 사용자가 만든 테스트 데이터라고 함. 그래도 서울 운영의 유일한 백업이므로 자체 백업 확보 전까지 쓰기·삭제 금지.
  ⑤ 1~2주 후(승인): 뭄바이의 실제 고객 데이터 삭제 → 테스트로 사용(001~017 적용해 정기결제 검증용). Vercel Preview env(현재 서울=운영을 가리킴)를 뭄바이로 변경. 개인정보처리방침 저장 국가 → 대한민국
- 2026-10-21 운영 Auth 설정 확인(읽기): mailer_autoconfirm=true(가입 시 메일 인증 없음), 커스텀 SMTP 없음, 메일 발송 한도 2통/시간. 기본 발송기는 조직 멤버 주소로만 보내는 제한이 있어 **실제 손님의 비밀번호 찾기 메일이 안 갈 가능성** → 실사용 전 커스텀 SMTP(Resend 등) 권장. 유료 전환 권장: Supabase Pro(자동정지·백업), Vercel Pro(Hobby는 상업적 이용 불가).
- 무료 운영 보완: 하루 1회 DB 깨우기(Vercel cron) 제안, 이사 시 자체 암호화 백업 필수(무료는 자동 백업 없음). 정기결제 시작 전 Pro 재검토.
- 정기결제 migration 012~017은 이제 새 운영(서울)에 적용한다. 단 테스트 DB(⑤ 이후 뭄바이)에서 먼저 검증.
- 토스 예약결제: 이사 전후 모두 결제가 `ready`에서 멈춤(토스 위젯 "결제 UI가 아직 렌더링되지 않았습니다"). 이사와 무관. 실결제 전 토스 키 종류(결제위젯 키인지)·토스 설정 점검 필요.

## 정기결제 (브랜치 `billing/subscription-v1`, 운영 미적용)
- master 미병합, 운영 DB에 migration 012~017 미적용.
- 운영 적용 전 필요: 토스 빌링 계약·실키, Vercel env(NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY, TOSS_BILLING_SECRET_KEY, BILLING_KEY_ENCRYPTION_KEY, CRON_SECRET), 개인정보처리방침·약관·환불정책 확정.
- 주의: Production에서 `test_` 토스 키를 거부하도록 바뀜 → 예약결제 키가 테스트 키인 상태로 배포하면 예약결제 중단.
- 적용 순서: 당일 운영 백업 → 012~017 연속 적용 → 즉시 새 코드 배포.
- 결제 실패 정책: 유예 없음, 실패 즉시 차단, 재결제일부터 새 이용기간.

## 검증 도구 (`crm/`)
- `npm run test:local` (PGlite + 가짜 토스, DB 접속 불필요)
- `npx tsc --noEmit`, `npm run lint`, `npm run build:test`
- `db:verify`, `test:e2e:*`, `db:migrate:prod` 등은 `.env.test`/운영 토큰이 필요해 사용자 PC에서만 실행.

## 작업 환경 (2026-10-20부터 웹 전용)
- 사용자는 claude.ai/code 웹 세션만 쓴다. "PC에서 하세요"라고 넘기지 말고 웹에서 해결 방법을 먼저 찾는다.
- 클라우드 환경 변수(값 출력 금지):
  - 운영: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (이름에 TEST 없는 것 = 운영 DB = 서울)
  - 테스트: SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, SUPABASE_TEST_SERVICE_ROLE_KEY, SUPABASE_TEST_ACCESS_TOKEN (= 뭄바이)
  - ✅ 2026-10-20 이름표 교체 확인: 운영 이름 URL·ANON·SERVICE_ROLE = `gmnw…`(서울), TEST 이름 = `evrg…`(뭄바이). 새 세션에서도 ref 앞 4글자만 비교해 재확인. 단 뭄바이는 ⑤ 전까지 운영 백업이므로 `db:reset:test`·`test:e2e`·`db:migrate:test` 등 테스트 DB를 쓰는 명령은 여전히 금지.
  - SUPABASE_TEST_ACCESS_TOKEN은 2026-10-20 기준 "Invalid access token"(만료/불량). 뭄바이 조회는 SUPABASE_MGMT_TOKEN_MUMBAI 사용.
  - Supabase 관리 토큰: SUPABASE_MGMT_TOKEN_SEOUL(서울=운영, 읽기+쓰기), SUPABASE_MGMT_TOKEN_MUMBAI(뭄바이, 읽기 전용)
  - 기타: NEXT_PUBLIC_TOSS_CLIENT_KEY / TOSS_SECRET_KEY (test_ 키), BACKUP_ENCRYPTION_KEY (2026-10-21 정상 32바이트 확인), BUSINESS_NUMBER_PEPPER, VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID (CRM 프로젝트)
  - 없음: 정기결제 env 4개. SUPABASE_PROD_ACCESS_TOKEN은 서울(현 운영)만 보이는 토큰이라 이름이 맞게 됨(있다면 운영 migration에 사용 가능, 사용 전 대상 ref 확인)
- crm/.env.local, crm/.env.test 파일은 없다. 필요하면 위 환경 변수로 세션 안에서만 만들고 절대 커밋하지 않는다.
- 현재 VERCEL_TOKEN은 Vercel CLI에서 실패한다(User not found / Could not retrieve Project Settings). API는 정상 → CRM 배포는 `git archive origin/master crm | tar -x -C <dir>` 후 `node crm/scripts/vercel-api-deploy.mjs <dir>/crm` (production 배포, READY까지 대기). 배포 전 운영 배포 ID 기록. 네트워크는 Full.
- 키를 쓰는 명령이 권한 검사에 막히면, 사용자에게 모드 선택에서 승인 방식 모드로 바꾸라고 안내한다.
- crm/package-lock.json은 웹 VM의 npm ci와 안 맞는다(PC와 기존 Vercel 배포는 정상). 검증은 npm install --no-package-lock 으로 하고, lockfile은 사용자 지시 전에 수정하지 않는다.

## 실제 오픈 전 필수 단계 (2026-10-21 사용자 지시)
- 사용자가 "○월 ○일 오픈" 같이 날짜를 정하면, 아래를 **급한 순서로 번호 매겨 "꼭 해야 한다"고 먼저 알린다.** 그 전에도 오픈·실사용·손님 가입 이야기가 나오면 상기시킨다.
  0. 개인정보처리방침 공개(개인정보보호법 공개 의무. 운영 홈페이지 하단 링크가 현재 `#`) + 유료 판매 전 사업자 정보 표시(전자상거래법). 빈칸 정보는 사용자 준비 필요.
  1. Supabase Pro 전환(자동 정지 방지·매일 백업). 업그레이드 자체는 코드 수정 불필요. 같은 조직에 뭄바이 프로젝트가 있으면 추가 컴퓨트 비용(~$10/월) 확인, Spend Cap 유지.
  2. 메일 발송(커스텀 SMTP, Resend 등) 연결 — 손님 비밀번호 찾기 메일. 한국어 메일 문구 복원도 같이.
  3. Vercel Pro 전환(Hobby는 상업적 이용 불가) — 유료 손님 받기 전.
  4. 토스 예약결제 `ready` 멈춤 원인 점검(키 종류·설정) — 예약결제를 쓸 거면.
  5. 정기결제 시작 시: 위 "정기결제 운영 적용 준비"의 준비물(토스 빌링·정책 빈칸) 전부.
  6. 권장: 오류 알림(Sentry 등), 코드서명 인증서(설치 경고 줄이기, 연 30~60만 원, (주)넥스트정보기술 명의).
- 다음 데스크톱 버전(v1.0.4) 때 같이 넣기: package.json `author`(또는 companyName)를 "(주)넥스트정보기술"로 → Windows 앱 목록 게시자 표시(무료). 설치 경고 창의 게시자는 코드서명 인증서로만 가능.

## 다음 단계 추천 방식
- 사용자는 비개발자다. 매 작업이 끝나면 "다음 추천 단계"를 1개 제안한다. 왜 필요한지, 사용자가 할 일(있다면)을 쉬운 한국어로 짧게 쓴다.
- 운영에 영향이 있는 작업(운영 DB, 배포, master push, Vercel/Supabase 설정)은 실행 전에 무엇이 바뀌는지 알리고 "진행할까요?"로 승인을 받는다. 그 외(코드 수정, 테스트, 작업 브랜치 커밋·push)는 요청받으면 바로 한다.
- 추천 우선순위:
  1. 데스크톱 v1.0.3 사용자 PC 확인(제목줄 v1.0.3·매니온 아이콘·로그인 유지·바로가기 이름)
  2. 저장소 비공개 전환 검토 (데스크톱 앱 EXE가 GitHub Release에 있어서, 다운로드 링크 영향부터 확인)
  3. 정기결제 운영 적용 준비 — **2026-10-21 사용자 지시로 보류.** 지금은 홈페이지·CRM 수정을 먼저 한다. 사용자가 정기결제·유료화·실결제·정책 페이지 공개 이야기를 꺼내거나, 이 일이 필요한 작업(정기결제 배포, 정책 페이지 master 반영, 결제 관련 수정)을 할 때 **반드시 먼저 아래 준비물을 한 번 상기시킨다.**
     - 토스 빌링 계약·실키 (계약 명의 = 약관 운영 회사와 같아야 함)
     - 약관·개인정보처리방침·환불정책 빈칸: 운영 회사 = (주)넥스트정보기술(사용자 확인). 남은 것: 대표자명(사업자등록증의 대표이사), 사업자등록번호, 통신판매업 신고번호(미신고면 신고 필요), 사업장 주소, 문의 이메일, 개인정보 보호책임자 성명·직책(사용자 본인 가능), 시행일, 무료체험 기록 보관기간(예시 3년)
     - Claude가 고칠 것: privacy.html 저장 위치 "인도(뭄바이)" → "대한민국(서울)", 서버 처리 지역도 서울로
     - 이후 순서: 테스트 DB 재검증 → 당일 운영 백업 → 012~017 적용 → 배포
  - 운영 백업: 2026-10-21 04:58 UTC 운영(서울) 백업 완료(CRM 테이블 + auth 비밀번호 해시 별도 파일, 암호화, 복호화 대조 일치), 파일은 사용자에게 전달(저장소엔 없음). BACKUP_ENCRYPTION_KEY는 현재 정상 32바이트.
  4. 미착수 제안: 체험 남용 방지(사업자번호 검증·이메일 인증), 홈페이지 다운로드 메뉴, review_required 관리자 화면
- 사용자 준비물이 없어서 막힌 단계는 건너뛰고, 할 수 있는 다음 단계를 추천한다.

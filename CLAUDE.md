# 매니온 프로젝트 작업 안내 (Claude Code용)

이 저장소는 공개(PUBLIC)입니다. 토큰·비밀키·운영 DB 주소·고객 데이터를 파일이나 커밋에 절대 넣지 마세요.

## 구성
- 루트(`index.html`, `style.css`, `app.js`): 매니온 소개 홈페이지. Vercel 프로젝트 `beauty-site`, GitHub 연동, **master push = 즉시 운영 배포**.
- `crm/`: 예약관리 CRM (Next.js 16 + Supabase + 토스페이먼츠). Vercel 프로젝트 `beauty-site-crm`, GitHub 미연동(CLI 배포만), 서버 리전 bom1.
- `desktop-app/`: CRM 웹을 여는 Electron 앱. 주소가 `main.js`에 고정됨.

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
2. Supabase 운영 Auth Redirect URL에 `https://app.manion.kr/**` 추가 (이후 Site URL 변경)
3. CRM `NEXT_PUBLIC_APP_URL` 변경 후 재배포 — **반드시 master 기준**(git archive + API 배포 스크립트). 이 결제 브랜치에서 배포하면 미적용 결제 코드가 운영에 올라감.
4. 홈페이지 `app.js`의 `CRM_APP_URL` → `https://app.manion.kr` (master push = 운영 반영)
5. 데스크톱 앱 새 버전(새 주소 허용) 배포 (`desktop-app/README.md` 절차)

## 운영 배포 기록
- 2026-10-20: master `3d5dba6` = 보안 핫픽스(버튼 처리중·비밀번호 규칙·보안 헤더·S-1·S-4) + 로그인/회원가입/비밀번호 찾기 "매니온 홈으로" 링크. CRM 운영 배포 `dpl_GzDZcZgrQipGgT9j6jkJvJhLY1TH` (롤백 대상: 직전 `dpl_29j3FhqmCyLvEwsGDV5FebVDdp3L`). app.manion.kr·옛 주소 모두 확인 완료.
- 홈페이지 정책 페이지(terms/privacy/refund.html)는 이 브랜치에만 있음. "확인 필요" 칸(사업자 정보·보호책임자·시행일·보관기간)을 채우고 사용자 승인 후 master에 반영.

## 장애 기록
- 2026-10-20: 운영·테스트 Supabase가 무료 플랜 자동 일시정지(INACTIVE)로 로그인 전부 실패(화면엔 "비밀번호 틀림"으로 표시). 사용자가 대시보드에서 Restore로 복구. 운영 프로젝트 = Supabase 대시보드의 "shinseongmin1-sketch's Project"(ref `evrg…`, ap-south-1 뭄바이). 테스트 = manion-crm-test(ref `gmnw…`, 서울). morelol은 무관. 현재 SUPABASE_PROD_ACCESS_TOKEN은 테스트 프로젝트만 보인다(운영 Management API 작업 시 운영 접근 토큰 별도 필요). 재발 방지로 운영 Pro 플랜 전환 권장.

## 운영 Supabase 서울 이사 (2026-10-20 사용자 결정, 준비 단계)
- 목표: 운영 DB 뭄바이(ap-south-1) → 서울 새 프로젝트 `manion-crm-prod`(ap-northeast-2) + Vercel 함수 리전 bom1 → icn1.
- 이 웹 환경은 DB 직접 연결(5432 TCP)과 *.supabase.co 접속이 막혀 있다. Supabase Management API(api.supabase.com, `/v1/projects/{ref}/database/query`)는 된다 → SQL API로 스키마 적용·데이터 복사.
- 요금제: 지금은 **무료 플랜으로 진행**(사용자 결정). Pro는 나중에 조직 요금제만 바꾸면 됨(재이사 불필요).
- 무료 = 활성 프로젝트 2개 제한 → 이사 기간엔 테스트(manion-crm-test)를 일시정지하고, 리허설은 새 서울 프로젝트에서 직접 한 뒤 비우고 전환 때 재복사. 전환 후 1~2주는 롤백용으로 옛 뭄바이 유지 → 이후 뭄바이 정지/삭제(승인) → 테스트 Restore.
- 무료 운영 보완: 하루 1회 DB 깨우기(Vercel cron) 추가 제안, 이사 시 자체 암호화 백업 필수(무료는 자동 백업 없음). 정기결제(유료 고객) 시작 전 Pro 재검토.
- 사용자 준비물: 개인 Access Token을 클라우드 env `SUPABASE_MGMT_TOKEN`으로 등록 후 새 세션. 테스트 일시정지는 이사 시작 시 요청.
- 순서: ① 새 프로젝트 생성 + schema.sql·001~011 적용 + Auth 설정 복사(redirect에 app.manion.kr 포함) ② 리허설: 운영 읽기만 해서 auth.users/auth.identities(비밀번호 해시 포함)·public 테이블 복사(트리거·identity 시퀀스 주의: on_auth_user_created, audit 트리거) → 행 수·체크섬 대조 → 새 DB 연결 미리보기 CRM에서 사용자 확인 ③ 승인 후 전환: 점검 시간, 직전 백업, 최종 복사·대조, Vercel env(URL/ANON/SERVICE_ROLE) 교체 + 리전 icn1 + master 기준 API 배포, 확인(문제 시 env 원복) ④ 전원 재로그인 필요(비밀번호 유지) ⑤ 1~2주 후 뭄바이 정리(삭제 전 승인), 개인정보처리방침 저장 국가 → 대한민국.
- 서울 이사 전에는 정기결제 migration 012~017을 운영에 적용하지 않는다(이사 후 새 프로젝트에 적용).

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
  - 운영: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (이름에 TEST 없는 것 = 운영 DB)
  - 테스트: SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, SUPABASE_TEST_SERVICE_ROLE_KEY, SUPABASE_TEST_ACCESS_TOKEN
  - 기타: NEXT_PUBLIC_TOSS_CLIENT_KEY / TOSS_SECRET_KEY (test_ 키), BACKUP_ENCRYPTION_KEY (33바이트 불량값일 수 있음, 운영 백업 전 확인), BUSINESS_NUMBER_PEPPER, VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID (CRM 프로젝트)
  - 없음: SUPABASE_PROD_ACCESS_TOKEN (운영 migration 때 사용자에게 요청), 정기결제 env 4개
- crm/.env.local, crm/.env.test 파일은 없다. 필요하면 위 환경 변수로 세션 안에서만 만들고 절대 커밋하지 않는다.
- 현재 VERCEL_TOKEN은 Vercel CLI에서 실패한다(User not found / Could not retrieve Project Settings). API는 정상 → CRM 배포는 `git archive origin/master crm | tar -x -C <dir>` 후 `node crm/scripts/vercel-api-deploy.mjs <dir>/crm` (production 배포, READY까지 대기). 배포 전 운영 배포 ID 기록. 네트워크는 Full.
- 키를 쓰는 명령이 권한 검사에 막히면, 사용자에게 모드 선택에서 승인 방식 모드로 바꾸라고 안내한다.
- crm/package-lock.json은 웹 VM의 npm ci와 안 맞는다(PC와 기존 Vercel 배포는 정상). 검증은 npm install --no-package-lock 으로 하고, lockfile은 사용자 지시 전에 수정하지 않는다.

## 다음 단계 추천 방식
- 사용자는 비개발자다. 매 작업이 끝나면 "다음 추천 단계"를 1개 제안한다. 왜 필요한지, 사용자가 할 일(있다면)을 쉬운 한국어로 짧게 쓴다.
- 운영에 영향이 있는 작업(운영 DB, 배포, master push, Vercel/Supabase 설정)은 실행 전에 무엇이 바뀌는지 알리고 "진행할까요?"로 승인을 받는다. 그 외(코드 수정, 테스트, 작업 브랜치 커밋·push)는 요청받으면 바로 한다.
- 추천 우선순위:
  1. 도메인 남은 단계 1~5 (CLAUDE.md 순서대로. 1번은 사용자가 app.manion.kr에서 직접 확인)
  2. 저장소 비공개 전환 검토 (데스크톱 앱 EXE가 GitHub Release에 있어서, 다운로드 링크 영향부터 확인)
  3. 정기결제 운영 적용 준비: 사용자 준비물(토스 빌링 계약·실키, 개인정보처리방침·약관·환불정책) 진행 확인 → 준비되면 테스트 DB 재검증 → 운영 백업 → 012~017 적용 → 배포
  4. 미착수 제안: 체험 남용 방지(사업자번호 검증·이메일 인증), 홈페이지 다운로드 메뉴, review_required 관리자 화면
- 사용자 준비물이 없어서 막힌 단계는 건너뛰고, 할 수 있는 다음 단계를 추천한다.

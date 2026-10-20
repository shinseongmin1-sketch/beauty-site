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
1. 사용자가 `https://app.manion.kr`에서 로그인·예약·예약결제 직접 확인
2. Supabase 운영 Auth Redirect URL에 `https://app.manion.kr/**` 추가 (이후 Site URL 변경)
3. CRM `NEXT_PUBLIC_APP_URL` 변경 후 재배포 — **반드시 master 기준**(git archive 방식). 이 결제 브랜치에서 배포하면 미적용 결제 코드가 운영에 올라감.
4. 홈페이지 `app.js`의 `CRM_APP_URL` → `https://app.manion.kr` (master push = 운영 반영)
5. 데스크톱 앱 새 버전(새 주소 허용) 배포 (`desktop-app/README.md` 절차)

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

## 웹(클라우드) 세션 한계
- `.env.local`, `.env.test`, Vercel/Supabase CLI 인증은 사용자 PC에만 있음. 웹 세션에서는 코드 수정·로컬 테스트까지만 하고, 배포·DB·Vercel 설정은 사용자 PC 세션에서 진행.

# 예약관리 CRM (beauty-site 2단계)

매장 사장님이 로그인해서 쓰는 실제 예약/고객/직원/결제 관리 프로그램입니다.
`beauty-site`(마케팅 랜딩 페이지, 리포지토리 루트)의 2단계로, 별도의 Next.js
앱으로 이 `crm/` 폴더에 만들어졌습니다. 나중에 별도 Vercel 프로젝트로 배포하고,
마케팅 사이트의 "로그인" 버튼에서 이 앱으로 연결합니다.

## 기능

- 회원가입 / 로그인 (Supabase Auth)
- 매장(업체) 온보딩
- 예약 관리: 등록/상태변경(대기·확정·완료·취소·노쇼)/삭제, 날짜별 조회
- 고객 관리: 등록/메모/예약 이력 조회
- 직원 관리: 등록/활성화 토글/역할 구분
- 시술·메뉴 관리: 이름/소요시간/가격
- 결제: 토스페이먼츠 결제위젯 연동 (테스트 키 기본 내장, 실키로 교체 가능)
- 네이버예약 연동 자리: `reservations.source`/`external_id` 컬럼과 웹훅 라우트
  스텁을 미리 준비해둠 (네이버 파트너센터 승인 후 연동 코드만 채우면 됨)

## 스택

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + Supabase (Postgres,
Auth) + 토스페이먼츠 결제위젯 SDK.

## 처음 실행하기

1. [supabase.com](https://supabase.com)에서 새 프로젝트 생성
2. Supabase 대시보드 → SQL Editor에서 `supabase/schema.sql` 전체 실행
   (테이블, RLS 정책, 회원가입 트리거가 한 번에 생성됩니다)
3. Supabase 프로젝트 설정 → Authentication → Email에서, 테스트 중에는
   "Confirm email"을 꺼두면 가입 즉시 로그인되어 편합니다
4. `.env.local.example`을 `.env.local`로 복사하고 Supabase URL/anon key를 채우기
5. 의존성 설치 및 실행

   ```bash
   npm install
   npm run dev
   ```

6. `http://localhost:3000` 접속 → 회원가입 → 매장 정보 입력 → 대시보드 진입

## 결제 테스트

기본 상태로 바로 결제 테스트가 가능합니다 (토스페이먼츠 공식 문서에 공개된
샌드박스 키가 기본값으로 들어가 있음). 예약 상세 페이지 → "결제 요청하기" →
토스 테스트 카드 정보로 결제 진행. 실제 매장 결제로 전환하려면:

1. [토스페이먼츠 개발자센터](https://developers.tosspayments.com)에서 가맹점
   심사를 받고 실 API 키를 발급받는다
2. `.env.local`의 `TOSS_SECRET_KEY`(서버) / `NEXT_PUBLIC_TOSS_CLIENT_KEY`(공용
   기본값)를 실키로 교체하거나, 매장별로 다른 키를 쓰려면 대시보드 →
   "매장 설정"에서 매장별 Client Key를 입력한다

## 네이버예약 연동

아직 연동 전입니다. 네이버 파트너센터에서 사업자 등록·API 사용 승인을 받은 뒤:

1. `src/app/api/integrations/naver/webhook/route.ts`의 TODO를 채워 네이버예약
   웹훅(신규/변경/취소 알림)을 받아 `reservations` 테이블에
   `source: 'naver'`, `external_id: <네이버 예약 ID>`로 반영
2. 대시보드 → "매장 설정"에서 네이버예약 업체 ID를 입력해두면 매장 매핑에 사용 가능

## 배포

이 `crm/` 폴더를 별도 Vercel 프로젝트로 연결해 배포하세요
(Root Directory를 `crm`으로 지정). 배포 후 나온 도메인을, 마케팅 사이트
루트의 `index.html` / `app.js`에 있는 `CRM_APP_URL` 값에 반영하면 마케팅
사이트의 "로그인" 버튼이 이 앱으로 연결됩니다.

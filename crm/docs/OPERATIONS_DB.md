# DB 운영 문서 (beauty-site-crm)

> 대상은 `beauty-site-crm`(예약프로그램)의 Supabase DB 뿐입니다. 마케팅 홈페이지(`beauty-site`)와는 무관합니다.
> 운영 DB에는 **테스트 프로젝트에서 검증을 통과한 SQL만** 적용합니다. 토큰/비밀번호는 코드나 Git에 저장하지 않습니다.

## 1. 현재 백업/복구 상태 (2026-09-21 확인)

| 항목 | 상태 | 근거 |
|---|---|---|
| 앱 코드 안의 백업 | **없음** | 백업 스크립트/크론/문서가 저장소에 존재하지 않았음 |
| Supabase 자체 백업 | **확인 못 함** | 요금제(Free/Pro)와 백업 설정은 Supabase 대시보드 → Database → Backups 에서만 확인 가능. 액세스 토큰 없이는 조회 불가 |
| 복구 테스트 | **한 번도 안 함** | 기록 없음 |

참고(Supabase 정책): Free 플랜은 내려받거나 되돌릴 수 있는 자동 백업이 제공되지 않고, Pro 플랜은 일일 백업(7일 보관)이 제공되며 PITR(시점 복구)은 유료 애드온입니다. **실제 고객 데이터를 받기 전에 대시보드에서 현재 요금제를 확인하세요.** 유료 고객 운영에는 Pro 이상(+PITR 검토)을 권장합니다.

이 저장소가 추가로 제공하는 것 (Supabase 백업과 별개의 2차 안전망):

- `scripts/backup.mjs` — CRM 테이블 17개 + 계정 목록(id/이메일/메타)을 **AES-256-GCM 암호화** 파일로 저장
- `scripts/restore.mjs` — 테스트 프로젝트에 복원 후 테이블별 행 수·체크섬 대조 (복구 드릴)
- 한계: 비밀번호 해시는 포함되지 않습니다. 계정 자체의 완전 복구는 Supabase 자체 백업 또는 `pg_dump`(DB 비밀번호 필요)로 해야 하고, 논리 백업으로 복구한 경우 사용자는 비밀번호 재설정이 필요합니다.

### 백업 실행 (사람이 직접 터미널에서)

```powershell
# 1) 암호화 키 생성 → 비밀번호 관리자 등 Git 밖에 보관 (분실하면 백업을 열 수 없음)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# 2) 현재 터미널 세션에만 키를 넣고 백업 (운영 DB는 읽기만 함)
$env:BACKUP_ENCRYPTION_KEY = "<위에서 만든 키>"
npm run db:backup:prod
```

결과물은 `backups/`(Git 무시)에 저장됩니다. 정기 실행(GitHub Actions 등)과 보관 정책(일 30개·월 12개)은 7단계에서 구현합니다.

### 복구 시나리오

| 상황 | 절차 |
|---|---|
| 특정 데이터를 실수로 삭제 | (Pro) 대시보드 Backups에서 복원 / (논리 백업) 백업 파일을 테스트 프로젝트에 복원 → 필요한 행만 SQL로 운영에 되돌림 |
| DB/프로젝트 전체 장애 | ① 새 Supabase 프로젝트 생성 → ② `.env.test` 를 새 프로젝트로 지정하고 `npm run db:migrate:test`(스키마 재구성) → ③ `npm run db:restore:test -- --file=backups/<파일>` → ④ Vercel 환경변수(URL/키)를 새 프로젝트로 교체 후 재배포 → ⑤ 사용자에게 비밀번호 재설정 안내 |
| 마이그레이션 적용 실패 | 각 마이그레이션은 트랜잭션이라 실패 시 자동 롤백됨. 성공 후 문제가 생기면 파일 하단의 ROLLBACK 주석 참고 |

## 2. 테스트 → 운영 적용 절차

```
npm run db:local-test      # (자동) 로컬 SQL 테스트 — 어떤 DB에도 연결하지 않음
npm run db:verify          # 005 적용 → 앱 흐름 테스트 → tsc/eslint → 006 적용 → 전체 통합 테스트. 전부 통과해야 .verified.json 기록
                           # (재실행하려면 먼저: npm run db:reset:test -- --confirm=<테스트 ref>)
npm run db:plan            # 운영에 실행될 SQL 전체를 supabase/prod-apply/PLAN_*.sql 로 출력 (실행 안 함)
npm run db:backup:prod     # 운영 백업 (2시간 이내 백업이 없으면 적용 거부)
$env:SUPABASE_PROD_ACCESS_TOKEN = "<토큰>"   # 세션 환경변수로만. 파일 저장 금지
npm run db:migrate:prod -- --confirm=<운영 프로젝트 ref>
```

운영 적용은 아래를 **모두** 만족해야 실행됩니다 (`scripts/migrate.mjs`):

1. `db:verify` 통과 기록(`.verified.json`)에 있고 파일 체크섬이 같을 것 — 검증 뒤에 SQL을 고치면 다시 거부됨
2. `--confirm=<ref>` 직접 입력
3. 2시간 이내 운영 백업 존재
4. 토큰은 `SUPABASE_PROD_ACCESS_TOKEN` 환경변수로만 전달
5. 적용된 파일의 내용이 바뀌면 거부 (수정은 새 번호 파일로)

운영 DB는 001~004가 SQL Editor로 수동 적용된 상태라 최초 1회만 기록 작업이 필요합니다:
`npm run db:migrate:prod -- --baseline-through=4 --confirm=<ref>` (SQL은 실행하지 않고 적용 기록만 남김).

## 3. 마이그레이션 목록

| 파일 | 내용 | 운영 영향 | 되돌리기 |
|---|---|---|---|
| `005_privilege_escalation_expand.sql` | 함수 3개 추가 (`create_my_business`, `set_member_role`, `current_staff_role`) | 기존 동작 변화 없음(추가만) | 파일 상단 주석의 `drop function` |
| `006_privilege_escalation_lockdown.sql` | `profiles`/`businesses`/`staff` 직접 쓰기 권한 회수 + 트리거. role·business_id·owner_id 직접 변경 차단 | 새 앱 코드 배포 **이후** 적용. 그 전에 적용하면 구버전 온보딩 실패 | 파일 하단 ROLLBACK |
| `007_role_based_access.sql` | 직급별 RLS 재작성: 직원=고객·예약·상담 조회/등록/수정만(삭제 불가), 매출·결제수단 대표/관리자만, 알림설정·마케팅 대표만, 분류·담당자 쓰기 대표/관리자만. `has_role()` 함수 추가 | 직원 계정의 기존 삭제/매출 접근이 DB에서 막힘(의도). 대표/관리자 동작은 동일 | 파일 하단 ROLLBACK |
| `008_staff_invitations.sql` | 직원 계정 초대: `staff_invitations` 테이블 + 생성/취소/해제/수락 함수, 연결된 담당자 행 삭제 차단 | 추가 위주. 기존 데이터 변경 없음 | 파일 하단 ROLLBACK |
| `009_subscriptions_trials.sql` | 무료체험/구독: `subscriptions`·`trial_history`·`platform_settings` 테이블, 사업장 컬럼(대표자명·사업자번호 해시/마스킹), 쓰기 차단 RESTRICTIVE 정책, `create_my_business` 서명 변경(사업자번호 해시 필수), `set_business_number`·`sync_my_subscription`·`expire_due_trials`, 기존 사업장 3개월 백필 | **기존 사업장은 적용 시점부터 3개월 무료체험으로 백필(쓰기 유지)**. `create_my_business` 서명이 바뀌므로 새 앱 코드와 함께 배포. 앱에 `BUSINESS_NUMBER_PEPPER` 환경변수 필요 | 파일 하단 ROLLBACK |
| `010_platform_admin_audit.sql` | 플랫폼 관리자(`platform_admins`, `is_platform_admin`, 운영자 전용 조회 함수 `admin_*`) + 감사 로그(`audit_logs`, 자동 기록 트리거, 서버 전용 기록 함수, append-only) + 문의 테이블 구조(`inquiries`) | 기존 데이터 변경 없음(추가만). 이후 모든 매장 데이터 변경에 로그 행이 1건씩 추가됨. **운영자 계정은 적용 후 `scripts/platform-admin.mjs` 로 별도 등록**해야 함 | 파일 하단 ROLLBACK (audit_logs 는 append-only 라 트리거를 먼저 제거) |
| `011_customer_import_export.sql` | 고객 Import/Export: audit_logs metadata 허용 키에 success_count/error_count 추가, `import_customers(jsonb)` 함수(대표/관리자 전용, 단일 트랜잭션, advisory lock 으로 동시 Import 직렬화, 등급/태그 자동 생성 없음, 빈 값=기존 값 유지) | 추가 위주. 기존 customers 테이블/컬럼/트리거는 변경 없음 | 파일 하단 ROLLBACK |

**적용 순서(운영)**: 005 → 006 → 007 → 008 → 009 → 010 → 011 를 한 번의 점검 시간에 연속 적용하고 곧바로 새 앱 코드를 배포합니다. 009 는 008(초대 함수)과 007(`has_role`)에 의존하고, 새 앱 코드는 009 의 `create_my_business` 새 서명과 `subscriptions` 조회를 사용합니다. 적용~배포 사이에는 신규 가입(온보딩)만 일시적으로 실패할 수 있고 기존 사용자의 조회/등록은 계속 동작합니다(기존 사업장은 009 백필로 3개월 체험이 부여됨). **배포 전 Vercel 환경변수 `BUSINESS_NUMBER_PEPPER` 를 새로 만들어 등록**해야 합니다 (테스트와 다른 값, 안전한 곳에 별도 보관 — 분실/교체하면 기존 사업자번호 해시와 불일치해 중복 방지가 깨집니다).

**운영자 계정 등록(적용 후, 사람이 직접)**: 운영자용 계정을 일반 방식으로 가입한 뒤 `$env:SUPABASE_PROD_ACCESS_TOKEN="..."; node scripts/platform-admin.mjs add --email=<운영자 이메일> --target=prod --confirm=<운영 ref>`. 이메일은 코드/파일에 저장하지 않고 실행 시 인자로만 받습니다. 매장 계정과 분리된 전용 계정을 권장합니다. 목록/해제: `list` / `deactivate`. 등록·해제는 감사 로그에 자동 기록됩니다.

**감사 로그 개인정보/보관기간(법률 검토 후 확정할 항목)**: IP·User-Agent 저장 여부(`platform_settings.audit_log_store_ip` / `audit_log_store_user_agent`, 기본 false=저장 안 함), 보관기간(`audit_log_retention_months`, 기본 null=미확정)과 로그별 `retain_until`(기본 null). 로그는 UPDATE/DELETE/TRUNCATE 가 트리거로 막혀 있어, 보관기간이 확정되면 만료 로그를 지우는 별도 마이그레이션(전용 정리 함수)이 필요합니다.

**운영 적용 후 확인**: 대표 계정으로 로그인해 대시보드/예약/고객/매출/직원 화면이 정상인지, 직원 계정(있다면)이 매출·설정에 접근하지 못하는지 확인. 이상 시 각 파일 하단의 ROLLBACK 을 역순(008→007→006)으로 실행.

## 4. 이후 마이그레이션에서 지켜야 할 규칙

- `businesses`/`staff`/`profiles` 에 컬럼을 추가하면 컬럼 단위 GRANT도 함께 추가할 것 (006 이후 기본은 "수정 불가")
- 테이블을 추가하면 `scripts/lib/tables.mjs` 에도 추가할 것 (누락 시 백업이 실패하도록 되어 있음)
- 이미 적용된 마이그레이션 파일은 수정하지 말고 새 번호로 추가할 것

import { redirect } from "next/navigation";
import type { StaffRole } from "./types";

// 로그인 계정(profiles.role)의 직급에 따라 접근 가능한 기능을 정의한다.
//   owner = 대표 관리자 / manager = 관리자 / staff = 직원
// staff 테이블의 role 은 "이 담당자가 로그인 계정을 갖게 될 경우의 직급"을 나타내며,
// 실제 접근 제어는 항상 현재 로그인한 profile.role 로 판단한다.
//
// 이 표는 서버(페이지·서버 액션)에서의 검사 기준이다. DB(RLS, migration 007)도 같은 정책을
// 독립적으로 강제하므로 여기를 우회해도 데이터 변경은 DB 에서 다시 차단된다.
const FEATURE_ACCESS = {
  // 직원도 사용: 고객·예약·상담의 조회/등록/수정
  reservations: ["owner", "manager", "staff"],
  customers: ["owner", "manager", "staff"],
  consultations: ["owner", "manager", "staff"],

  // 삭제는 대표·관리자만: 고객 / 예약 / 상담
  deleteRecords: ["owner", "manager"],

  // 분류·마스터 관리(시술/메뉴, 예약그룹·타입, 상담유형, 고객 등급·태그): 대표·관리자
  catalogs: ["owner", "manager"],

  // 예약 결제(토스) 및 결제 상태 조회: 대표·관리자
  payments: ["owner", "manager"],

  // 고객 데이터 Import/Export: 대표·관리자만 (직원은 조회/등록/수정만 가능하고 대량 반출·반입은 불가)
  dataExport: ["owner", "manager"],
  dataImport: ["owner", "manager"],

  revisit: ["owner", "manager"],
  sales: ["owner", "manager"],
  staffAdmin: ["owner", "manager"],
  marketing: ["owner"],
  settings: ["owner"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Feature = keyof typeof FEATURE_ACCESS;

export function canAccess(role: StaffRole, feature: Feature): boolean {
  return (FEATURE_ACCESS[feature] as readonly StaffRole[]).includes(role);
}

/**
 * 서버 컴포넌트/서버 액션 최상단에서 호출한다. 권한이 없으면 대시보드로 돌려보내고,
 * redirect() 는 예외를 던져 이후 코드(DB 쓰기 등)를 실행하지 않는다.
 * 화면에서 버튼을 숨기는 것과 무관하게, 서버 액션을 직접 호출해도 여기서 막힌다.
 */
export function requireAccess(role: StaffRole, feature: Feature) {
  if (!canAccess(role, feature)) {
    redirect("/dashboard");
  }
}

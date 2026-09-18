import { redirect } from "next/navigation";
import type { StaffRole } from "./types";

// 로그인 계정(profiles.role)의 권한 등급에 따라 접근 가능한 기능을 정의.
// staff 테이블의 role은 "이 담당자가 로그인 계정을 갖게 될 경우의 권한"을
// 함께 나타내며, 실제 접근 제어는 항상 현재 로그인한 profile.role로 판단한다.
const FEATURE_ACCESS = {
  reservations: ["owner", "manager", "staff"],
  customers: ["owner", "manager", "staff"],
  revisit: ["owner", "manager"],
  consultations: ["owner", "manager", "staff"],
  sales: ["owner", "manager"],
  marketing: ["owner"],
  settings: ["owner"],
  staffAdmin: ["owner", "manager"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Feature = keyof typeof FEATURE_ACCESS;

export function canAccess(role: StaffRole, feature: Feature): boolean {
  return (FEATURE_ACCESS[feature] as readonly StaffRole[]).includes(role);
}

/** 서버 컴포넌트 최상단에서 호출해 권한이 없으면 대시보드로 돌려보낸다. */
export function requireAccess(role: StaffRole, feature: Feature) {
  if (!canAccess(role, feature)) {
    redirect("/dashboard");
  }
}

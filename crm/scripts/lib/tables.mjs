// 백업/복구 대상 CRM 테이블 (외래키 순서: 부모 → 자식).
// 같은 Supabase 프로젝트에 있는 다른 앱(community_*, rank_history)은 이 스크립트의 대상이 아니다.
// 새 마이그레이션으로 테이블을 추가하면 여기에도 추가해야 한다 (누락 시 backup.mjs 가 경고).
export const CRM_TABLES = [
  "businesses",
  "subscriptions",
  "trial_history",
  "platform_settings",
  "profiles",
  "staff",
  "customers",
  "services",
  "reservation_groups",
  "reservation_types",
  "customer_grades",
  "customer_tags",
  "payment_methods",
  "consultation_types",
  "reservations",
  "payments",
  "consultations",
  "customer_tag_links",
  "notification_settings",
  "marketing_messages",
  "staff_invitations",
  "platform_admins",
  "audit_logs",
  "inquiries",
];

export const OTHER_APP_TABLES = [
  /^community_/,
  /^rank_history$/,
  /^_crm_migrations$/,
];

/** 스키마에 있지만 백업 목록에도 제외 목록에도 없는 테이블 이름들 (백업 누락 방지용 검사). */
export function findUnlistedTables(allTables) {
  return allTables.filter(
    (t) => !CRM_TABLES.includes(t) && !OTHER_APP_TABLES.some((re) => re.test(t))
  );
}

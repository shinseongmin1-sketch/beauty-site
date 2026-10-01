// 백업/복구 대상 CRM 테이블 (외래키 순서: 부모 → 자식).
// 같은 Supabase 프로젝트에 있는 다른 앱(community_*, rank_history)은 이 스크립트의 대상이 아니다.
// 새 마이그레이션으로 테이블을 추가하면 여기에도 추가해야 한다 (누락 시 backup.mjs 가 경고).
export const CRM_TABLES = [
  "businesses",
  "subscription_payment_methods", // 012: subscriptions.payment_method_id 가 참조하므로 subscriptions 보다 먼저 (→ businesses)
  "subscriptions",
  "subscription_payments", // 012: → subscriptions, subscription_payment_methods, businesses
  "trial_history",
  "platform_settings",
  "profiles",
  "staff",
  "customer_grades", // customers.grade_id 가 참조하므로 customers 보다 먼저
  "customers",
  "services",
  "reservation_groups",
  "reservation_types",
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

// 나중 마이그레이션이 만드는 테이블 → 만드는 마이그레이션 파일.
// 백업 시 DB 에 이 테이블이 없으면, 해당 마이그레이션이 "아직 적용되지 않은" 경우에만 건너뛴다.
// (마이그레이션이 적용됐는데 테이블이 없거나, 여기 없는 테이블이 없으면 백업을 중단한다 → 기존 테이블이 누락되는 일이 없다)
export const TABLE_INTRODUCED_BY = {
  subscription_payment_methods: "012_subscription_billing.sql",
  subscription_payments: "012_subscription_billing.sql",
};

// 테이블별 기본키 컬럼. 백업은 기본키 순서로 끊어 읽고(같은 created_at 이 많아도 순서가 고정됨),
// 복원 검증은 백업한 기본키가 대상 DB 에 모두 있는지로 확인한다. 여기 없는 테이블은 ["id"].
// (tests/local/backup-tables.test.mjs 가 실제 스키마의 기본키와 일치하는지 검사한다)
export const TABLE_PRIMARY_KEYS = {
  platform_settings: ["key"],
  customer_tag_links: ["customer_id", "tag_id"],
  platform_admins: ["user_id"],
};

export const primaryKeyOf = (table) => TABLE_PRIMARY_KEYS[table] ?? ["id"];

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

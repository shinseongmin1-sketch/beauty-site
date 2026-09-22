// 예약 프로그램 전체에서 쓰는 도메인 타입 정의.
// supabase/schema.sql 의 테이블 구조와 1:1로 맞춰져 있음.

export type StaffRole = "owner" | "manager" | "staff";
export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";
export type ReservationSource = "internal" | "naver";
export type PaymentStatus =
  | "ready"
  | "paid"
  | "failed"
  | "cancelled"
  | "partial_cancelled";

export interface Business {
  id: string;
  owner_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  business_hours: Record<string, unknown> | null;
  naver_booking_id: string | null;
  toss_client_key: string | null;
  representative_name: string | null;
  business_number_masked: string | null; // 원문은 저장하지 않는다 (해시 + 마스킹 표기만)
  created_at: string;
}

export interface Profile {
  id: string;
  business_id: string | null;
  role: StaffRole;
  full_name: string | null;
  phone: string | null;
  created_at: string;
}

export interface Staff {
  id: string;
  business_id: string;
  profile_id: string | null;
  name: string;
  phone: string | null;
  title: string | null;
  role: StaffRole;
  color: string;
  active: boolean;
  created_at: string;
}

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  owner: "대표 관리자",
  manager: "관리자",
  staff: "직원",
};

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  memo: string | null;
  grade_id: string | null;
  created_at: string;
}

export interface CustomerGrade {
  id: string;
  business_id: string;
  name: string;
  created_at: string;
}

export interface CustomerTag {
  id: string;
  business_id: string;
  name: string;
  created_at: string;
}

export interface CustomerWithMeta extends Customer {
  grade: Pick<CustomerGrade, "id" | "name"> | null;
  tags: Pick<CustomerTag, "id" | "name">[];
}

export interface Service {
  id: string;
  business_id: string;
  name: string;
  duration_minutes: number;
  price: number;
  active: boolean;
  created_at: string;
}

export interface ReservationGroup {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
}

export interface ReservationType {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  color: string;
  active: boolean;
  created_at: string;
}

export const CONSULTATION_RESULTS = ["상담중", "상담완료", "보류"] as const;
export type ConsultationResult = (typeof CONSULTATION_RESULTS)[number];

export interface ConsultationType {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
}

export interface Consultation {
  id: string;
  business_id: string;
  customer_id: string | null;
  staff_id: string | null;
  consult_date: string;
  type: string | null; // 과거 기록용(더 이상 신규 입력에 사용하지 않음)
  type_id: string | null;
  content: string | null;
  result: string;
  next_consult_date: string | null;
  memo: string | null;
  created_at: string;
}

export interface ConsultationWithRelations extends Consultation {
  customer: Pick<Customer, "id" | "name" | "phone"> | null;
  staff: Pick<Staff, "id" | "name" | "color"> | null;
  type_ref: Pick<ConsultationType, "id" | "name"> | null;
}

export interface Reservation {
  id: string;
  business_id: string;
  customer_id: string | null;
  staff_id: string | null;
  service_id: string | null;
  group_id: string | null;
  reservation_type_id: string | null;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  source: ReservationSource;
  external_id: string | null;
  memo: string | null;
  content: string | null;
  created_at: string;
}

export interface ReservationWithRelations extends Reservation {
  customer: Pick<Customer, "id" | "name" | "phone"> | null;
  staff: Pick<Staff, "id" | "name" | "color"> | null;
  service: Pick<Service, "id" | "name" | "duration_minutes" | "price"> | null;
  group: Pick<ReservationGroup, "id" | "name"> | null;
  reservation_type: Pick<ReservationType, "id" | "name" | "color"> | null;
}

export interface PaymentMethodEntity {
  id: string;
  business_id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface Payment {
  id: string;
  business_id: string;
  reservation_id: string | null;
  customer_id: string | null;
  staff_id: string | null;
  service_id: string | null;
  amount: number; // 최종 결제금액
  gross_amount: number; // 할인 전 결제금액
  discount_amount: number;
  method: string | null; // 과거 기록용(더 이상 신규 입력에 사용하지 않음)
  method_id: string | null;
  status: PaymentStatus;
  toss_payment_key: string | null;
  toss_order_id: string | null;
  paid_at: string | null;
  memo: string | null;
  created_at: string;
}

export interface PaymentWithRelations extends Payment {
  customer: Pick<Customer, "id" | "name" | "phone"> | null;
  staff: Pick<Staff, "id" | "name"> | null;
  service: Pick<Service, "id" | "name"> | null;
  payment_method: Pick<PaymentMethodEntity, "id" | "name"> | null;
}

export interface NotificationSettings {
  id: string;
  business_id: string;
  reservation_created: boolean;
  reservation_updated: boolean;
  reservation_cancelled: boolean;
  reservation_reminder: boolean;
  channel: "sms" | "kakao";
  reservation_created_message: string | null;
  reservation_updated_message: string | null;
  reservation_cancelled_message: string | null;
  reservation_reminder_message: string | null;
  reservation_reminder_timing: string | null;
  updated_at: string;
}

export const REMINDER_TIMING_OPTIONS = [
  { value: "1hour", label: "예약 1시간 전" },
  { value: "3hours", label: "예약 3시간 전" },
  { value: "1day", label: "예약 1일 전" },
  { value: "2days", label: "예약 2일 전" },
] as const;

export interface MarketingMessage {
  id: string;
  business_id: string;
  target_description: string;
  message: string;
  channel: "sms" | "kakao";
  status: string;
  created_at: string;
}

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "대기",
  confirmed: "예약완료",
  completed: "방문완료",
  cancelled: "취소",
  no_show: "노쇼",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  ready: "결제대기",
  paid: "결제완료",
  failed: "결제실패",
  cancelled: "결제취소",
  partial_cancelled: "부분취소",
};

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
  role: StaffRole;
  color: string;
  active: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  memo: string | null;
  created_at: string;
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

export interface Reservation {
  id: string;
  business_id: string;
  customer_id: string | null;
  staff_id: string | null;
  service_id: string | null;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  source: ReservationSource;
  external_id: string | null;
  memo: string | null;
  created_at: string;
}

export interface ReservationWithRelations extends Reservation {
  customer: Pick<Customer, "id" | "name" | "phone"> | null;
  staff: Pick<Staff, "id" | "name" | "color"> | null;
  service: Pick<Service, "id" | "name" | "duration_minutes" | "price"> | null;
}

export interface Payment {
  id: string;
  business_id: string;
  reservation_id: string | null;
  amount: number;
  method: string | null;
  status: PaymentStatus;
  toss_payment_key: string | null;
  toss_order_id: string | null;
  paid_at: string | null;
  created_at: string;
}

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "대기중",
  confirmed: "확정",
  completed: "완료",
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

import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { createReservation } from "../actions";

export default async function NewReservationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; date?: string }>;
}) {
  const { error, date } = await searchParams;
  const { supabase, business } = await requireBusinessContext();

  const [{ data: customers }, { data: staff }, { data: services }] = await Promise.all([
    supabase
      .from("customers")
      .select("id,name,phone")
      .eq("business_id", business.id)
      .order("name"),
    supabase
      .from("staff")
      .select("id,name")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("services")
      .select("id,name,duration_minutes,price")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("name"),
  ]);

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">새 예약 등록</h1>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      <form action={createReservation} className="space-y-5 rounded-xl border border-border bg-card p-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">날짜</label>
            <input
              type="date"
              name="date"
              required
              defaultValue={date ?? format(new Date(), "yyyy-MM-dd")}
              className="w-full rounded-lg border border-border px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">시간</label>
            <input type="time" name="time" required className="w-full rounded-lg border border-border px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">기존 고객 선택</label>
          <select name="customer_id" className="w-full rounded-lg border border-border px-3 py-2">
            <option value="">직접 입력 (아래에 신규 고객 정보 입력)</option>
            {(customers ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.phone ? `(${c.phone})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">신규 고객 이름</label>
            <input
              type="text"
              name="new_customer_name"
              className="w-full rounded-lg border border-border px-3 py-2"
              placeholder="기존 고객 선택 시 비워두세요"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">신규 고객 연락처</label>
            <input type="tel" name="new_customer_phone" className="w-full rounded-lg border border-border px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">담당 직원</label>
          <select name="staff_id" className="w-full rounded-lg border border-border px-3 py-2">
            <option value="">미지정</option>
            {(staff ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">시술/메뉴</label>
          <select name="service_id" className="w-full rounded-lg border border-border px-3 py-2">
            <option value="">미지정 (기본 60분)</option>
            {(services ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.duration_minutes}분 · {s.price.toLocaleString()}원
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">메모</label>
          <textarea name="memo" rows={3} className="w-full rounded-lg border border-border px-3 py-2" />
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-gradient-to-r from-brand-pink to-brand-purple py-2.5 font-semibold text-white transition hover:opacity-90"
        >
          예약 등록
        </button>
      </form>
    </div>
  );
}

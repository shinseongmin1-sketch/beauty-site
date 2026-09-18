import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { CustomerCombobox } from "../../customer-combobox";
import { CONSULTATION_RESULTS } from "@/lib/types";
import { createConsultation } from "../actions";

export default async function NewConsultationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; customerId?: string }>;
}) {
  const { error, customerId } = await searchParams;
  const { supabase, business } = await requireBusinessContext();

  const [{ data: customers }, { data: staff }, { data: types }, { data: prefillCustomer }] = await Promise.all([
    supabase.from("customers").select("id,name,phone").eq("business_id", business.id).order("name"),
    supabase
      .from("staff")
      .select("id,name")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("consultation_types")
      .select("id,name")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("created_at"),
    customerId
      ? supabase.from("customers").select("id,name,phone").eq("id", customerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-[26px] font-bold text-foreground">상담 등록</h1>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <form action={createConsultation} className="space-y-5 rounded-2xl border border-border bg-card p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">고객 검색</label>
          <CustomerCombobox customers={customers ?? []} initial={prefillCustomer ?? null} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">상담일</label>
            <input
              type="date"
              name="consult_date"
              required
              defaultValue={format(new Date(), "yyyy-MM-dd")}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">상담유형</label>
            <select name="type_id" className="w-full rounded-lg border border-border px-3 py-2 text-sm">
              <option value="">미지정</option>
              {(types ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {(types ?? []).length === 0 && (
              <p className="mt-1 text-xs text-muted">
                등록된 상담유형이 없습니다.{" "}
                <a href="/dashboard/consultations" className="text-accent hover:underline">
                  상담관리
                </a>
                에서 먼저 추가해보세요.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">상담담당자</label>
          <select name="staff_id" className="w-full rounded-lg border border-border px-3 py-2 text-sm">
            <option value="">미지정</option>
            {(staff ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">상담내용</label>
          <textarea
            name="content"
            rows={4}
            placeholder="고객과 상담한 내용을 입력하세요"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">상담결과</label>
            <select name="result" className="w-full rounded-lg border border-border px-3 py-2 text-sm">
              {CONSULTATION_RESULTS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">다음 상담일</label>
            <input type="date" name="next_consult_date" className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">메모</label>
          <textarea name="memo" rows={2} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-accent py-2.5 font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          상담등록
        </button>
      </form>
    </div>
  );
}

import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import Link from "next/link";
import { CustomerCombobox } from "../../customer-combobox";
import { createSale } from "../actions";
import { SaleAmountFields } from "../amount-fields";

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; customerId?: string }>;
}) {
  const { error, customerId } = await searchParams;
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "sales");

  const [{ data: customers }, { data: staff }, { data: services }, { data: methods }, { data: prefillCustomer }] =
    await Promise.all([
      supabase.from("customers").select("id,name,phone").eq("business_id", business.id).order("name"),
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
      supabase
        .from("payment_methods")
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
      <h1 className="text-[26px] font-bold text-foreground">매출등록</h1>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <form action={createSale} className="space-y-5 rounded-2xl border border-border bg-card p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">고객</label>
          <CustomerCombobox customers={customers ?? []} initial={prefillCustomer ?? null} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">서비스 / 상품</label>
            <select name="service_id" className="w-full rounded-lg border border-border px-3 py-2 text-sm">
              <option value="">미지정</option>
              {(services ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">담당자</label>
            <select name="staff_id" className="w-full rounded-lg border border-border px-3 py-2 text-sm">
              <option value="">미지정</option>
              {(staff ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SaleAmountFields />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">결제방법</label>
            <select name="method_id" className="w-full rounded-lg border border-border px-3 py-2 text-sm">
              <option value="">미지정</option>
              {(methods ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              필요한 결제방법이 없나요?{" "}
              <Link href="/dashboard/sales/methods" className="text-accent hover:underline">
                결제방법 관리
              </Link>
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">결제일</label>
            <input
              type="date"
              name="paid_at"
              required
              defaultValue={format(new Date(), "yyyy-MM-dd")}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
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
          매출등록
        </button>
      </form>
    </div>
  );
}

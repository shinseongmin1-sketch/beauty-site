import { requireBusinessContext } from "@/lib/business";
import type { Service } from "@/lib/types";
import { addService, deleteService, toggleServiceActive } from "./actions";

export default async function ServicesPage() {
  const { supabase, business } = await requireBusinessContext();

  const { data } = await supabase
    .from("services")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at")
    .returns<Service[]>();

  const services = data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-bold text-foreground">시술/메뉴 관리</h1>

      <form
        action={addService}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-4"
      >
        <input name="name" required placeholder="메뉴 이름" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <input
          type="number"
          name="duration_minutes"
          defaultValue={60}
          min={5}
          step={5}
          placeholder="소요시간(분)"
          className="rounded-lg border border-border px-3 py-2 text-sm"
        />
        <input
          type="number"
          name="price"
          defaultValue={0}
          min={0}
          step={1000}
          placeholder="가격(원)"
          className="rounded-lg border border-border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent hover:bg-accent-hover px-3 py-2 text-sm font-medium text-white"
        >
          + 메뉴 추가
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-3">메뉴</th>
              <th className="p-3">소요시간</th>
              <th className="p-3">가격</th>
              <th className="p-3">상태</th>
              <th className="p-3">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {services.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  등록된 메뉴가 없습니다.
                </td>
              </tr>
            )}
            {services.map((s) => (
              <tr key={s.id}>
                <td className="p-3">{s.name}</td>
                <td className="p-3">{s.duration_minutes}분</td>
                <td className="p-3">{s.price.toLocaleString()}원</td>
                <td className="p-3">{s.active ? "판매중" : "숨김"}</td>
                <td className="p-3">
                  <div className="flex gap-3">
                    <form action={toggleServiceActive.bind(null, s.id, !s.active)}>
                      <button className="text-accent hover:underline">
                        {s.active ? "숨기기" : "판매 재개"}
                      </button>
                    </form>
                    <form action={deleteService.bind(null, s.id)}>
                      <button className="text-red-500 hover:underline">삭제</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

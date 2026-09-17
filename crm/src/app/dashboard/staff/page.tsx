import { requireBusinessContext } from "@/lib/business";
import type { Staff } from "@/lib/types";
import { addStaff, deleteStaff, toggleStaffActive } from "./actions";

export default async function StaffPage() {
  const { supabase, business } = await requireBusinessContext();

  const { data } = await supabase
    .from("staff")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at")
    .returns<Staff[]>();

  const staff = data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">직원 관리</h1>

      <form
        action={addStaff}
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-5"
      >
        <input name="name" required placeholder="이름" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <input name="phone" placeholder="연락처" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <select name="role" className="rounded-lg border border-border px-3 py-2 text-sm">
          <option value="staff">직원</option>
          <option value="manager">매니저</option>
        </select>
        <input
          type="color"
          name="color"
          defaultValue="#c44dff"
          className="h-10 w-full rounded-lg border border-border"
        />
        <button
          type="submit"
          className="rounded-lg bg-gradient-to-r from-brand-pink to-brand-purple px-3 py-2 text-sm font-medium text-white"
        >
          + 직원 추가
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/5 text-muted">
            <tr>
              <th className="p-3">이름</th>
              <th className="p-3">연락처</th>
              <th className="p-3">역할</th>
              <th className="p-3">상태</th>
              <th className="p-3">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  등록된 직원이 없습니다.
                </td>
              </tr>
            )}
            {staff.map((s) => (
              <tr key={s.id}>
                <td className="p-3">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </td>
                <td className="p-3">{s.phone ?? "-"}</td>
                <td className="p-3">{s.role === "owner" ? "대표" : s.role === "manager" ? "매니저" : "직원"}</td>
                <td className="p-3">{s.active ? "근무중" : "비활성"}</td>
                <td className="p-3">
                  <div className="flex gap-3">
                    <form action={toggleStaffActive.bind(null, s.id, !s.active)}>
                      <button className="text-brand-purple hover:underline">
                        {s.active ? "비활성화" : "활성화"}
                      </button>
                    </form>
                    {s.role !== "owner" && (
                      <form action={deleteStaff.bind(null, s.id)}>
                        <button className="text-red-500 hover:underline">삭제</button>
                      </form>
                    )}
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

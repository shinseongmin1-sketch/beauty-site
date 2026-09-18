import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import type { Staff } from "@/lib/types";
import { addStaff } from "./actions";
import { StaffTableClient } from "./table-client";

export default async function StaffPage() {
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "staffAdmin");

  const { data } = await supabase
    .from("staff")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at")
    .returns<Staff[]>();

  const staff = data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-bold text-foreground">담당자 / 권한 관리</h1>

      <form
        action={addStaff}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-6"
      >
        <input name="name" required placeholder="이름" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <input name="phone" placeholder="연락처" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <input name="title" placeholder="직책 (예: 네일 담당)" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <select name="role" className="rounded-lg border border-border px-3 py-2 text-sm">
          <option value="staff">직원</option>
          <option value="manager">관리자</option>
        </select>
        <input
          type="color"
          name="color"
          defaultValue="#c44dff"
          className="h-10 w-full rounded-lg border border-border"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent hover:bg-accent-hover px-3 py-2 text-sm font-medium text-white"
        >
          + 담당자 추가
        </button>
      </form>

      <StaffTableClient staff={staff} />
    </div>
  );
}

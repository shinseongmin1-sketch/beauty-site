import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import type { CustomerTag, MarketingMessage } from "@/lib/types";
import { createMarketingDraft } from "./actions";
import { TargetPicker } from "./target-picker";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; customerName?: string; sent?: string; error?: string }>;
}) {
  const { customerName, sent, error } = await searchParams;
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "marketing");

  const [{ data: messages }, { data: tags }] = await Promise.all([
    supabase
      .from("marketing_messages")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<MarketingMessage[]>(),
    supabase.from("customer_tags").select("*").eq("business_id", business.id).order("created_at").returns<CustomerTag[]>(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">문자 / 알림</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          실제 SMS/카카오 알림톡 발송 연동 전 단계입니다. 지금은 발송 대상과 메시지를 등록해두면, 추후 API
          연동 시 그대로 발송할 수 있도록 저장됩니다.
        </p>
      </div>

      {sent === "1" && (
        <p className="rounded-lg bg-status-mint-bg px-4 py-3 text-sm text-status-mint-text">
          발송 대기 목록에 등록했습니다. (실제 발송 기능은 추후 연동 예정)
        </p>
      )}
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <form action={createMarketingDraft} className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">발송 대상</label>
          <TargetPicker tags={tags ?? []} defaultValue={customerName ? `${customerName} 고객` : ""} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">메시지 내용</label>
          <textarea name="message" required rows={4} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="channel" value="sms" defaultChecked />
            SMS
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="channel" value="kakao" />
            알림톡
          </label>
        </div>
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
          발송 등록
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <h2 className="border-b border-border p-4 font-semibold text-foreground">발송 대기/이력</h2>
        {(messages ?? []).length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">등록된 발송 내역이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
            {(messages ?? []).map((m) => (
              <li key={m.id} className="p-4 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-foreground">{m.target_description}</p>
                  <span className="rounded-full bg-status-gray-bg px-2.5 py-1 text-xs font-semibold text-status-gray-text">
                    {m.channel === "kakao" ? "알림톡" : "SMS"} · 발송대기
                  </span>
                </div>
                <p className="mt-1.5 text-muted">{m.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

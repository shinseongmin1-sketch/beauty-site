import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import { REMINDER_TIMING_OPTIONS, type NotificationSettings } from "@/lib/types";
import { updateNotificationSettings } from "./actions";

export default async function NotificationSettingsPage() {
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "settings");

  const { data: settings } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("business_id", business.id)
    .maybeSingle<NotificationSettings>();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">알림 설정</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          실제 SMS/알림톡 발송은 아직 연결되어 있지 않습니다. 여기서 설정한 사용 여부·문구는 추후 연동 시 그대로
          사용됩니다.
        </p>
      </div>

      <form action={updateNotificationSettings} className="space-y-5">
        <NotificationRuleCard
          title="예약 등록 알림"
          enabledName="reservation_created"
          defaultChecked={settings?.reservation_created ?? true}
          messageName="reservation_created_message"
          defaultMessage={settings?.reservation_created_message ?? "예약이 등록되었습니다."}
        />
        <NotificationRuleCard
          title="예약 변경 알림"
          enabledName="reservation_updated"
          defaultChecked={settings?.reservation_updated ?? true}
          messageName="reservation_updated_message"
          defaultMessage={settings?.reservation_updated_message ?? "예약이 변경되었습니다."}
        />
        <NotificationRuleCard
          title="예약 취소 알림"
          enabledName="reservation_cancelled"
          defaultChecked={settings?.reservation_cancelled ?? true}
          messageName="reservation_cancelled_message"
          defaultMessage={settings?.reservation_cancelled_message ?? "예약이 취소되었습니다."}
        />
        <NotificationRuleCard
          title="예약 전 알림"
          enabledName="reservation_reminder"
          defaultChecked={settings?.reservation_reminder ?? true}
          messageName="reservation_reminder_message"
          defaultMessage={settings?.reservation_reminder_message ?? "예약 하루 전입니다. 잊지 말고 방문해주세요."}
        >
          <div>
            <label className="mb-1 block text-sm font-medium">발송 시점</label>
            <select
              name="reservation_reminder_timing"
              defaultValue={settings?.reservation_reminder_timing ?? "1day"}
              className="w-full max-w-xs rounded-lg border border-border px-3 py-2 text-sm"
            >
              {REMINDER_TIMING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </NotificationRuleCard>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 font-semibold text-foreground">발송 방법</h2>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="channel" value="sms" defaultChecked={(settings?.channel ?? "sms") === "sms"} />
              SMS
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="channel" value="kakao" defaultChecked={settings?.channel === "kakao"} />
              알림톡
            </label>
          </div>
        </div>

        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
          저장
        </button>
      </form>
    </div>
  );
}

function NotificationRuleCard({
  title,
  enabledName,
  defaultChecked,
  messageName,
  defaultMessage,
  children,
}: {
  title: string;
  enabledName: string;
  defaultChecked: boolean;
  messageName: string;
  defaultMessage: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-foreground">{title}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name={enabledName} defaultChecked={defaultChecked} className="rounded border-border" />
          사용
        </label>
      </div>
      {children}
      <div>
        <label className="mb-1 block text-sm font-medium">메시지 내용</label>
        <textarea
          name={messageName}
          rows={2}
          defaultValue={defaultMessage}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}

import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { IconBell } from "./icons";

export function DashboardHeader({ businessName, subscriptionLabel }: { businessName: string; subscriptionLabel?: string | null }) {
  const today = format(new Date(), "yyyy년 M월 d일 (EEE)", { locale: ko });

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-8">
      <div className="flex items-center gap-3">
        <p className="text-sm font-semibold text-foreground">{businessName}</p>
        {subscriptionLabel && (
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">{subscriptionLabel}</span>
        )}
      </div>
      <div className="flex items-center gap-4 text-sm text-muted">
        <span>{today}</span>
        <button
          type="button"
          aria-label="알림"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-background hover:text-foreground"
        >
          <IconBell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}

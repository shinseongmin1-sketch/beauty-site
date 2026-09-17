import { requireBusinessContext } from "@/lib/business";
import { ScheduleCard } from "../schedule-card";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const { supabase, business } = await requireBusinessContext();
  const selectedDate = date ? new Date(`${date}T00:00:00`) : new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">일정 관리</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          날짜를 선택해서 예약 일정을 자세히 확인하세요.
        </p>
      </div>

      <ScheduleCard
        supabase={supabase}
        businessId={business.id}
        selectedDate={selectedDate}
        basePath="/dashboard/schedule"
      />
    </div>
  );
}

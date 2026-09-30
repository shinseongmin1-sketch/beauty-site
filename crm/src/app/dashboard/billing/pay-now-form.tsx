"use client";

import { useState } from "react";
import { payNow } from "./actions";
import { CycleChoice } from "./card-form";
import type { BillingCycle } from "@/lib/billing/plans";

/** 차단 상태: 등록된 카드로 바로 결제 (서버 액션). 금액은 서버/DB 가 정한다. */
export function PayNowForm({ defaultCycle, cardLabel }: { defaultCycle: BillingCycle; cardLabel: string }) {
  const [cycle, setCycle] = useState<BillingCycle>(defaultCycle);
  const [pending, setPending] = useState(false);
  return (
    <form action={payNow} onSubmit={() => setPending(true)} className="space-y-4">
      <CycleChoice value={cycle} onChange={setCycle} name="cycle" />
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>
          {cardLabel}로 지금 결제하고, 결제 시각부터 새 이용기간을 시작합니다. 해지하기 전까지 {cycle === "monthly" ? "매월" : "매년"} 같은
          금액이 자동결제되는 것에 동의합니다.
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? "결제 중…" : "결제하기"}
      </button>
    </form>
  );
}

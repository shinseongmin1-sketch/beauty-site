"use client";

import { useState } from "react";
import { resumeAutoRenewal } from "./actions";
import type { BillingCycle } from "@/lib/billing/plans";

/** 해지한 구독을 다시 연장 (자동결제 다시 켜기). 지금 결제하지 않는다. 동의는 서버가 다시 기록한다. */
export function ResumeAutoRenewalForm({ cycle }: { cycle: BillingCycle }) {
  const [pending, setPending] = useState(false);
  return (
    <form action={resumeAutoRenewal} onSubmit={() => setPending(true)} className="space-y-3" data-resume-form>
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>해지하기 전까지 {cycle === "monthly" ? "매월" : "매년"} 같은 금액이 자동결제되는 것에 동의합니다.</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? "처리 중…" : "구독 연장하기 (자동결제 다시 켜기)"}
      </button>
    </form>
  );
}

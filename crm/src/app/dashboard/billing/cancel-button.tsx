"use client";

import { useState } from "react";
import { Modal } from "../overlay";
import { cancelAutoRenewal } from "./actions";

/** 자동결제 해지 버튼 + 확인 창. 해지해도 현재 이용기간은 줄지 않는다. */
export function CancelAutoRenewalButton({ periodEndLabel }: { periodEndLabel: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-background"
      >
        자동결제 해지
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="자동결제를 해지하시겠습니까?">
        <div className="space-y-4 text-sm text-foreground">
          <p data-cancel-confirm>
            해지해도 현재 이용기간인 <b>{periodEndLabel}</b>까지는 서비스를 계속 이용할 수 있습니다.
          </p>
          <p className="text-muted">이후 자동결제가 진행되지 않으며, 이용기간 종료 후 서비스 이용(등록·수정·삭제)이 제한됩니다. 데이터는 삭제되지 않습니다.</p>
          <form action={cancelAutoRenewal} onSubmit={() => setPending(true)} className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-xl border border-border py-2.5 font-medium hover:bg-background">
              취소
            </button>
            <button type="submit" disabled={pending} className="flex-1 rounded-xl bg-red-500 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60">
              {pending ? "처리 중…" : "자동결제 해지"}
            </button>
          </form>
        </div>
      </Modal>
    </>
  );
}

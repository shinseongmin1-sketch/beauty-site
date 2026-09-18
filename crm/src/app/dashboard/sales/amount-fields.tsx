"use client";

import { useState } from "react";

export function SaleAmountFields() {
  const [gross, setGross] = useState(0);
  const [discount, setDiscount] = useState(0);
  const final = Math.max(gross - discount, 0);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium">결제금액</label>
        <input
          type="number"
          name="gross_amount"
          min={0}
          step={1000}
          required
          value={gross || ""}
          onChange={(e) => setGross(Number(e.target.value) || 0)}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">할인금액</label>
        <input
          type="number"
          name="discount_amount"
          min={0}
          step={1000}
          value={discount || ""}
          onChange={(e) => setDiscount(Number(e.target.value) || 0)}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </div>
      <div className="col-span-2 rounded-lg bg-background p-3">
        <p className="text-sm text-muted">
          최종결제금액 <span className="ml-2 text-base font-bold text-foreground">{final.toLocaleString()}원</span>
        </p>
      </div>
    </div>
  );
}

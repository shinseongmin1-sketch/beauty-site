"use client";

import { useState } from "react";

export function TargetPicker({
  tags,
  defaultValue,
}: {
  tags: { id: string; name: string }[];
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="space-y-2">
      <input
        name="target_description"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="예: 재방문 필요 고객, VIP 고객, 홍길동 고객 등"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm"
      />
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">고객 태그로 빠르게 채우기:</span>
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setValue(`"${t.name}" 태그 고객`)}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-background"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

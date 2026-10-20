"use client";

import { useFormStatus } from "react-dom";

// 폼 전송 버튼. 누르면 바로 "처리 중" 표시로 바뀌고 다시 누를 수 없게 막는다.
// (응답이 느려도 눌린 걸 알 수 있고, 두 번 눌러 중복 요청되는 것을 막는다)
export function SubmitButton({
  children,
  pendingText = "처리 중…",
  className = "w-full rounded-lg bg-accent hover:bg-accent-hover py-2.5 font-semibold text-white transition-colors",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      {pending ? pendingText : children}
    </button>
  );
}

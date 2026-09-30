"use client";

import { createContext, useContext, useState } from "react";

// 768px(md) 미만에서는 왼쪽 사이드바를 화면 밖에 숨겨두고, 헤더의 햄버거 버튼으로 여닫는 드로어로 쓴다.
// md 이상(태블릿 가로·PC·Windows 프로그램)은 기존처럼 항상 보이는 고정 사이드바 그대로다.

const MobileNavContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <MobileNavContext.Provider value={{ open, setOpen }}>{children}</MobileNavContext.Provider>;
}

export function SidebarShell({ children }: { children: React.ReactNode }) {
  const { open, setOpen } = useContext(MobileNavContext);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-navy/40 md:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside
        id="dashboard-sidebar"
        // 메뉴 링크를 누르면 드로어를 닫는다 (페이지 이동 후에도 열린 채로 남지 않게).
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
        className={`fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col overflow-y-auto bg-navy text-white transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:overflow-visible md:transition-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="메뉴 닫기"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-navy-muted hover:bg-white/10 hover:text-white md:hidden"
        >
          ✕
        </button>
        {children}
      </aside>
    </>
  );
}

export function MobileMenuButton() {
  const { open, setOpen } = useContext(MobileNavContext);
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label="메뉴 열기"
      aria-expanded={open}
      aria-controls="dashboard-sidebar"
      className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-background md:hidden"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Modal } from "./overlay";
import { IconPlusCircle, IconSearch } from "./icons";

export interface QuickCategoryItem {
  id: string;
  name: string;
  description?: string | null;
  color?: string;
  active?: boolean;
}

/**
 * 예약관리 화면에서 예약그룹/예약타입을 화면 이동 없이 바로 조회·추가·수정할 수 있는
 * 좌측 퀵 패널. groups/actions.ts, types/actions.ts의 서버 액션을 그대로 재사용해서
 * 별도 관리 페이지(설정 > 항목 관리)와 동일한 데이터를 쓴다.
 */
export function QuickCategoryPanel({
  title,
  entityLabel,
  items,
  selectedId,
  onSelect,
  withColor,
  addAction,
  updateAction,
  deleteAction,
  readOnly,
}: {
  title: string;
  entityLabel: string;
  items: QuickCategoryItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  withColor?: boolean;
  addAction: (formData: FormData) => Promise<void>;
  updateAction: (id: string, formData: FormData) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
  /** 직원 등 분류 관리 권한이 없는 경우: 조회/필터만 가능하고 추가·수정·삭제 버튼은 숨김 */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<QuickCategoryItem | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((g) => g.name.toLowerCase().includes(q));
  }, [items, query]);

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(item: QuickCategoryItem) {
    setEditing(item);
    setModalOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      if (editing) {
        await updateAction(editing.id, formData);
      } else {
        await addAction(formData);
      }
      setModalOpen(false);
      router.refresh();
    });
  }

  function handleDelete(item: QuickCategoryItem) {
    if (
      !window.confirm(
        `이 ${entityLabel}을(를) 삭제하시겠습니까?\n이미 이 ${entityLabel}으로 등록된 데이터는 삭제되지 않고 "미지정"으로 변경됩니다.`
      )
    )
      return;
    startTransition(async () => {
      await deleteAction(item.id);
      if (selectedId === item.id) onSelect("");
      router.refresh();
    });
  }

  return (
    <div className="h-fit rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        {searchOpen ? (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => {
              if (!query) setSearchOpen(false);
            }}
            placeholder={`${entityLabel} 검색`}
            className="w-full rounded-lg border border-border px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        ) : (
          <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label={`${title} 검색`}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <IconSearch className="h-4 w-4" />
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={openAdd}
              aria-label={`${title} 추가`}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-accent transition-colors hover:bg-accent-soft"
            >
              <IconPlusCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <ul className="space-y-0.5">
        <li>
          <button
            type="button"
            onClick={() => onSelect("")}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
              selectedId === "" ? "bg-accent-soft font-semibold text-accent" : "text-foreground hover:bg-background"
            }`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            전체
          </button>
        </li>
        {filteredItems.map((item) => (
          <li
            key={item.id}
            className="group relative"
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId((id) => (id === item.id ? null : id))}
          >
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-center gap-2 rounded-lg py-2 pl-2.5 pr-14 text-left text-sm transition-colors ${
                selectedId === item.id ? "bg-accent-soft font-semibold text-accent" : "text-foreground hover:bg-background"
              } ${item.active === false ? "opacity-50" : ""}`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: withColor && item.color ? item.color : "currentColor" }}
              />
              <span className="truncate">
                {item.name}
                {item.active === false ? " (사용 안 함)" : ""}
              </span>
            </button>
            {!readOnly && hoveredId === item.id && (
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(item);
                  }}
                  className="text-muted hover:text-accent hover:underline"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item);
                  }}
                  className="text-muted hover:text-red-500 hover:underline"
                >
                  삭제
                </button>
              </div>
            )}
          </li>
        ))}
        {filteredItems.length === 0 && (
          <li className="px-2.5 py-4 text-center text-xs text-muted">검색 결과가 없습니다.</li>
        )}
      </ul>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `${entityLabel} 수정` : `${entityLabel} 추가`}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{entityLabel}명</label>
            <input
              name="name"
              required
              defaultValue={editing?.name ?? ""}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">설명</label>
            <input
              name="description"
              defaultValue={editing?.description ?? ""}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>
          {withColor && (
            <div>
              <label className="mb-1 block text-sm font-medium">표시 색상</label>
              <input
                type="color"
                name="color"
                defaultValue={editing?.color || "#3b73e8"}
                className="h-10 w-20 rounded-lg border border-border"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background">
              취소
            </button>
            <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
              저장
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

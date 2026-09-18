"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal } from "./overlay";

export interface ManagedEntity {
  id: string;
  name: string;
  description: string | null;
  color?: string;
  active?: boolean;
}

export function EntityManagerClient({
  items,
  withColor,
  withDescription = true,
  withActive = false,
  title,
  description,
  addLabel,
  entityLabel,
  onAdd,
  onUpdate,
  onDelete,
  onToggleActive,
}: {
  items: ManagedEntity[];
  withColor?: boolean;
  withDescription?: boolean;
  withActive?: boolean;
  title: string;
  description: string;
  addLabel: string;
  entityLabel: string;
  onAdd: (formData: FormData) => Promise<void>;
  onUpdate: (id: string, formData: FormData) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleActive?: (id: string, active: boolean) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedEntity | null>(null);

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(item: ManagedEntity) {
    setEditing(item);
    setModalOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      if (editing) {
        await onUpdate(editing.id, formData);
      } else {
        await onAdd(formData);
      }
      setModalOpen(false);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm(`이 ${entityLabel}을(를) 삭제할까요?\n이미 사용 중인 데이터는 삭제되지 않고 "미지정"으로 표시됩니다.`)) return;
    startTransition(async () => {
      await onDelete(id);
      router.refresh();
    });
  }

  function handleToggleActive(id: string, nextActive: boolean) {
    if (!onToggleActive) return;
    startTransition(async () => {
      await onToggleActive(id, nextActive);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-foreground">{title}</h1>
          <p className="mt-1.5 text-[15px] text-muted">{description}</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          {addLabel}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted">
          아직 등록된 {entityLabel}이(가) 없습니다. 위 버튼으로 추가해보세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const isActive = item.active ?? true;
            return (
              <div
                key={item.id}
                className={`rounded-2xl border border-border bg-card p-4 ${!isActive ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {withColor && (
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ background: item.color || "#3b73e8" }}
                      />
                    )}
                    <p className="truncate font-semibold text-foreground">{item.name}</p>
                  </div>
                  {withActive && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        isActive ? "bg-status-mint-bg text-status-mint-text" : "bg-status-gray-bg text-status-gray-text"
                      }`}
                    >
                      {isActive ? "사용 중" : "사용 안 함"}
                    </span>
                  )}
                </div>
                {withDescription && <p className="mt-1 min-h-[20px] text-sm text-muted">{item.description || "-"}</p>}
                <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3 text-sm">
                  <button type="button" onClick={() => openEdit(item)} className="text-accent hover:underline">
                    수정
                  </button>
                  {withActive && onToggleActive && (
                    <button
                      type="button"
                      onClick={() => handleToggleActive(item.id, !isActive)}
                      className="text-muted hover:underline"
                    >
                      {isActive ? "사용 안 함으로 변경" : "사용하기"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="text-red-500 hover:underline"
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `${entityLabel} 수정` : addLabel.replace("+ ", "")}
      >
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
          {withDescription && (
            <div>
              <label className="mb-1 block text-sm font-medium">설명</label>
              <input
                name="description"
                defaultValue={editing?.description ?? ""}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>
          )}
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
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              저장
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

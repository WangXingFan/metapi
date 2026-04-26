import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inputStyle } from "../pages/lite/shared.js";

export type ColumnOption<T extends string = string> = {
  key: T;
  label: string;
};

const menuStyle: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 8px)",
  zIndex: 30,
  minWidth: 240,
  maxWidth: 280,
  padding: 12,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  boxShadow: "var(--shadow-lg)",
  display: "grid",
  gap: 8,
};

function readStoredColumns<T extends string>(storageKey: string, validKeys: Set<T>): T[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const next = parsed.filter((item): item is T => validKeys.has(item));
    return next.length > 0 ? next : null;
  } catch {
    return null;
  }
}

function writeStoredColumns<T extends string>(storageKey: string, values: T[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
    // Ignore storage failures; column selection still works for this session.
  }
}

export function useColumnVisibility<T extends string>(storageKey: string, columns: ColumnOption<T>[]) {
  const allKeys = useMemo(() => columns.map((column) => column.key), [columns]);
  const validKeys = useMemo(() => new Set(allKeys), [allKeys]);
  const [visibleColumns, setVisibleColumns] = useState<T[]>(() => {
    return readStoredColumns(storageKey, validKeys) || allKeys;
  });

  useEffect(() => {
    setVisibleColumns((current) => {
      const filtered = current.filter((key) => validKeys.has(key));
      return filtered.length > 0 ? filtered : allKeys;
    });
  }, [allKeys, validKeys]);

  useEffect(() => {
    writeStoredColumns(storageKey, visibleColumns);
  }, [storageKey, visibleColumns]);

  const visibleColumnSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);
  const isColumnVisible = useCallback(
    (key: T) => visibleColumnSet.has(key),
    [visibleColumnSet],
  );
  const toggleColumn = useCallback(
    (key: T) => {
      setVisibleColumns((current) => {
        if (current.includes(key)) {
          return current.length <= 1 ? current : current.filter((item) => item !== key);
        }
        return allKeys.filter((item) => item === key || current.includes(item));
      });
    },
    [allKeys],
  );
  const showAllColumns = useCallback(() => setVisibleColumns(allKeys), [allKeys]);

  return {
    visibleColumns,
    isColumnVisible,
    toggleColumn,
    showAllColumns,
  };
}

type ColumnVisibilityControlProps<T extends string> = {
  columns: ColumnOption<T>[];
  visibleColumns: T[];
  onToggleColumn: (key: T) => void;
  onShowAll: () => void;
  label?: string;
};

export function ColumnVisibilityControl<T extends string>({
  columns,
  visibleColumns,
  onToggleColumn,
  onShowAll,
  label = "显示列",
}: ColumnVisibilityControlProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visibleSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", justifySelf: "end" }}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen((current) => !current)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
        <span>{label}</span>
        <span style={{
          padding: "2px 6px",
          borderRadius: 999,
          background: "var(--color-primary-light)",
          color: "var(--color-primary)",
          fontSize: 12,
          fontWeight: 700
        }}>
          {visibleColumns.length}/{columns.length}
        </span>
      </button>
      {open ? (
        <div style={menuStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingBottom: 8, borderBottom: "1px solid var(--color-border-light)" }}>
            <strong style={{ fontSize: 14, fontWeight: 700 }}>选择显示列</strong>
            <button type="button" className="btn btn-link" onClick={onShowAll} style={{ padding: 0, fontSize: 13 }}>
              全选
            </button>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {columns.map((column) => {
              const checked = visibleSet.has(column.key);
              const disabled = checked && visibleColumns.length <= 1;
              return (
                <label
                  key={column.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: "var(--radius-sm)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                    background: checked ? "var(--color-primary-light)" : "transparent",
                    border: "1px solid transparent",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled) {
                      e.currentTarget.style.borderColor = "var(--color-border)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "transparent";
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggleColumn(column.key)}
                    style={{
                      width: 18,
                      height: 18,
                      margin: 0,
                      cursor: disabled ? "not-allowed" : "pointer",
                      accentColor: "var(--color-primary)",
                    }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 500, color: checked ? "var(--color-primary)" : "var(--color-text-primary)" }}>{column.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type RowAction = {
  key: string;
  label: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hidden?: boolean;
  danger?: boolean;
};

interface RowActionsProps {
  inline?: RowAction[];
  menu?: RowAction[];
  align?: 'left' | 'right';
  triggerLabel?: string;
}

type MenuPosition = {
  left: number;
  top: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function RowActions({
  inline = [],
  menu = [],
  align = 'right',
  triggerLabel = '更多操作',
}: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const canUsePortal = typeof document !== 'undefined'
    && !!document.body
    && typeof document.body.appendChild === 'function'
    && typeof document.body.removeChild === 'function'
    && typeof window !== 'undefined';

  const visibleInline = inline.filter((a) => !a.hidden);
  const visibleMenu = menu.filter((a) => !a.hidden);

  const refreshMenuPosition = useCallback(() => {
    if (!canUsePortal || !wrapRef.current || !menuRef.current) return;
    const triggerRect = wrapRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const viewportPadding = 10;
    const gap = 6;

    const preferredLeft = align === 'left'
      ? triggerRect.left
      : triggerRect.right - menuRect.width;
    const left = clamp(
      preferredLeft,
      viewportPadding,
      window.innerWidth - viewportPadding - menuRect.width,
    );

    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const top = spaceBelow >= menuRect.height + gap + viewportPadding
      ? triggerRect.bottom + gap
      : Math.max(viewportPadding, triggerRect.top - gap - menuRect.height);

    setMenuPosition({ left, top });
  }, [align, canUsePortal]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !canUsePortal) {
      setMenuPosition(null);
      return;
    }
    refreshMenuPosition();
  }, [canUsePortal, open, refreshMenuPosition, visibleMenu.length]);

  useEffect(() => {
    if (!open || !canUsePortal) return;
    const handleViewportChange = () => refreshMenuPosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [canUsePortal, open, refreshMenuPosition]);

  const menuNode = visibleMenu.length > 0 ? (
    <div
      ref={menuRef}
      className={`row-actions-menu${open ? '' : ' is-hidden'}${canUsePortal ? ' is-portal' : ''}`}
      role="menu"
      style={canUsePortal ? {
        position: 'fixed',
        left: menuPosition?.left ?? 0,
        top: menuPosition?.top ?? 0,
        right: 'auto',
        visibility: menuPosition ? 'visible' : 'hidden',
      } : undefined}
    >
      {visibleMenu.map((action, index) => {
        const previous = visibleMenu[index - 1];
        const showDivider = !!action.danger && !!previous && !previous.danger;
        return (
          <React.Fragment key={action.key}>
            {showDivider ? <div className="row-actions-divider" role="presentation" /> : null}
            <button
              type="button"
              role="menuitem"
              className={`row-actions-item${action.danger ? ' is-danger' : ''}`}
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="row-actions" data-align={align}>
      {visibleInline.map((action) => (
        <button
          key={action.key}
          type="button"
          className={`btn btn-link${action.danger ? ' btn-link-danger' : ''}`}
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </button>
      ))}
      {visibleMenu.length > 0 ? (
        <div className={`row-actions-menu-wrap${open ? ' is-open' : ''}`} ref={wrapRef}>
          <button
            type="button"
            className="row-actions-trigger"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={triggerLabel}
            onClick={() => setOpen((current) => !current)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="19" cy="12" r="1.7" />
            </svg>
          </button>
          {canUsePortal ? (open && menuNode ? createPortal(menuNode, document.body) : null) : menuNode}
        </div>
      ) : null}
    </div>
  );
}

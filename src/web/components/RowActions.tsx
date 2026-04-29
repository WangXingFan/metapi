import React, { useEffect, useRef, useState } from 'react';

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

export default function RowActions({
  inline = [],
  menu = [],
  align = 'right',
  triggerLabel = '更多操作',
}: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const visibleInline = inline.filter((a) => !a.hidden);
  const visibleMenu = menu.filter((a) => !a.hidden);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) setOpen(false);
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
          <div className={`row-actions-menu${open ? '' : ' is-hidden'}`} role="menu">
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
        </div>
      ) : null}
    </div>
  );
}

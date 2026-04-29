import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import CenteredModal from './CenteredModal.js';

type ConfirmTone = 'default' | 'danger' | 'warning';

export interface ConfirmOptions {
  title?: React.ReactNode;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
}

type Resolver = (value: boolean) => void;

interface InternalState extends ConfirmOptions {
  open: boolean;
}

const DEFAULT_STATE: InternalState = {
  open: false,
  message: '',
};

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (ctx) return ctx.confirm;
  return async (options: ConfirmOptions): Promise<boolean> => {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      return true;
    }
    const text = typeof options.message === 'string' ? options.message : String(options.message ?? '');
    return window.confirm(text);
  };
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<InternalState>(DEFAULT_STATE);
  const resolverRef = useRef<Resolver | null>(null);

  const close = useCallback((value: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setState((prev) => ({ ...prev, open: false }));
    if (resolver) resolver(value);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setState({ ...options, open: true });
    });
  }, []);

  const value = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm]);

  const tone: ConfirmTone = state.tone || 'default';
  const confirmClass = tone === 'danger'
    ? 'btn btn-primary btn-danger-primary'
    : tone === 'warning'
      ? 'btn btn-accent'
      : 'btn btn-primary';

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <CenteredModal
        open={state.open}
        onClose={() => close(false)}
        title={state.title || '请确认操作'}
        maxWidth={460}
        closeOnBackdrop
        closeOnEscape
        footer={(
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
              {state.cancelText || '取消'}
            </button>
            <button type="button" className={confirmClass} onClick={() => close(true)} autoFocus>
              {state.confirmText || '确认'}
            </button>
          </div>
        )}
      >
        <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
          {state.message}
        </div>
      </CenteredModal>
    </ConfirmContext.Provider>
  );
}

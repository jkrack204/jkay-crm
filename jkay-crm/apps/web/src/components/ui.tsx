/**
 * Small building blocks that reuse the mockups' CSS classes as-is:
 * toasts, modals, theme switch, notification bell.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Notification } from '../lib/types';
import { friendly } from '../lib/format';

/* -------------------------------- toasts -------------------------------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const seq = useRef(0);
  const show = useCallback((msg: string) => {
    const id = ++seq.current;
    setItems((x) => [...x, { id, msg }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-stack">
        {items.map((t) => (
          <div key={t.id} className="toast">
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* -------------------------------- modal --------------------------------- */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-overlay open" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width, width: '100%' } : undefined} role="dialog" aria-label={title}>
        <div className="modal__head">
          <h3>{title}</h3>
          <span className="modal__close" onClick={onClose} role="button" aria-label="Close">
            ✕
          </span>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Wraps a form submit: shows the server's error message as a toast. */
export function useAction<TArgs, TOut>(fn: (a: TArgs) => Promise<TOut>, opts: { ok?: string | ((o: TOut) => string); invalidate?: unknown[][] } = {}) {
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (opts.ok) toast(typeof opts.ok === 'function' ? opts.ok(out) : opts.ok);
    },
    onError: (e: Error) => toast(e.message),
  });
}

/* ----------------------------- theme switch ----------------------------- */
export function ThemeSwitch() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') ?? 'light');
  const set = (t: string) => {
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('jkay-theme', t);
    } catch {
      /* private mode */
    }
    setTheme(t);
  };
  return (
    <div className="theme-sw" role="group" aria-label="Colour theme">
      <button className={theme === 'light' ? 'on' : ''} onClick={() => set('light')}>
        Light
      </button>
      <button className={theme === 'dark' ? 'on' : ''} onClick={() => set('dark')}>
        Dark
      </button>
    </div>
  );
}

/* ----------------------------- notifications ---------------------------- */
const N_KIND: Record<string, { ico: string; bg: string; fg: string }> = {
  followup: { ico: '⏰', bg: '#fdf3e2', fg: '#8a6a22' },
  repeat: { ico: '↻', bg: '#fdf3d9', fg: '#7f6217' },
  escalation: { ico: '!', bg: '#fdefee', fg: '#9e433b' },
  handoff: { ico: '→', bg: '#edf6f0', fg: '#2f6741' },
  transfer: { ico: '⇄', bg: '#f4f0fb', fg: '#5c4b9b' },
  pool: { ico: '＋', bg: '#f1eee8', fg: '#7c776e' },
  move: { ico: '→', bg: '#eff3f8', fg: '#40628f' },
  won: { ico: '✓', bg: '#edf6f0', fg: '#2f6741' },
  lost: { ico: '✕', bg: '#fdefee', fg: '#9e433b' },
  visit: { ico: '⌖', bg: '#eff3f8', fg: '#3c5d87' },
  balance: { ico: '₹', bg: '#fdf3e2', fg: '#8a6a22' },
  discount: { ico: '%', bg: '#f4f0fb', fg: '#5c4b9b' },
};

export function Bell({ onOpenLead, footer }: { onOpenLead: (leadId: string, kind: string) => void; footer?: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number; notifications: Notification[] }>('/notifications'),
    refetchInterval: 30_000,
  });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readOne = useMutation({ mutationFn: (id: number) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const unread = data?.unread ?? 0;
  return (
    <div className="notif-wrap" ref={wrap}>
      <div className={`bell ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} title="Notifications">
        <span aria-hidden="true">✱</span>
        {unread > 0 && <span className="count">{unread}</span>}
      </div>
      <div className={`notif ${open ? 'on' : ''}`}>
        <div className="notif__head">
          <h3>Notifications</h3>
          <span className="act" onClick={() => readAll.mutate()}>
            Mark all read
          </span>
        </div>
        <div className="notif__list">
          {(data?.notifications ?? []).length === 0 && <div style={{ padding: '20px 14px', fontSize: 13, color: 'var(--text-muted)' }}>Nothing to catch up on.</div>}
          {(data?.notifications ?? []).map((n) => {
            const k = N_KIND[n.kind] ?? N_KIND.move!;
            return (
              <div
                key={n.id}
                className={`nitem ${n.read ? '' : 'unread'}`}
                onClick={() => {
                  if (!n.read) readOne.mutate(n.id);
                  setOpen(false);
                  if (n.leadId) onOpenLead(n.leadId, n.kind);
                }}
              >
                <span className="ico" style={{ background: k.bg, color: k.fg }}>
                  {k.ico}
                </span>
                <div>
                  <div className="t">{n.title}</div>
                  <div className="m">
                    {n.customer && <b style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{n.customer} · </b>}
                    {n.body}
                  </div>
                  <div className="at">{friendly(n.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="notif__foot">{footer ?? 'Hand-offs, transfers and follop reminders arrive here.'}</div>
      </div>
    </div>
  );
}

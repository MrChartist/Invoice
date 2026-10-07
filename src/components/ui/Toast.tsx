import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  duration?: number;
  onClose: () => void;
}

const TONE = {
  success: { icon: CheckCircle, colour: 'var(--profit)' },
  error: { icon: AlertTriangle, colour: 'var(--destructive)' },
  info: { icon: Info, colour: 'var(--primary)' },
} as const;

export function Toast({ message, tone = 'success', duration = 3200, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // One frame in the hidden state so the entrance transition actually runs.
    const raf = requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 260);
    }, duration);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [duration, onClose]);

  const { icon: Icon, colour } = TONE[tone];

  const node = (
    <div
      role="status"
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className="no-print"
      style={{
        position: 'fixed',
        bottom: 'calc(1.25rem + var(--bottom-bar-h, 0px))',
        right: '1.25rem',
        left: 'auto',
        zIndex: 10000,
        maxWidth: 'min(420px, calc(100vw - 2.5rem))',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${colour}`,
        boxShadow: 'var(--shadow-xl)',
        borderRadius: 'var(--radius-md)',
        padding: '0.875rem 1rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.625rem',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 220ms ease, transform 260ms cubic-bezier(0.34, 1.3, 0.64, 1)',
      }}
    >
      <Icon size={18} color={colour} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.45, flex: 1 }}>
        {message}
      </span>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => {
          setVisible(false);
          setTimeout(onClose, 260);
        }}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--muted-foreground)',
          cursor: 'pointer',
          display: 'flex',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <X size={15} />
      </button>
    </div>
  );

  return document.body ? createPortal(node, document.body) : null;
}

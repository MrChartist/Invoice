import { useEffect, useState } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ToastProps {
  message: string;
  duration?: number;
  onClose: () => void;
}

export function Toast({ message, duration = 3000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Wait for fade out animation
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const toastElement = (
    <div style={{
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 10000,
      background: 'var(--card)', border: '1px solid var(--border)',
      boxShadow: 'var(--shadow-xl)', borderRadius: 'var(--radius-md)',
      padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
      opacity: isVisible ? 1 : 0, transform: isVisible ? 'translateY(0)' : 'translateY(10px)',
      transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
    }}>
      <CheckCircle size={20} color="var(--profit)" />
      <span style={{ fontWeight: 500, fontSize: '0.9375rem', color: 'var(--foreground)' }}>{message}</span>
      <button onClick={() => { setIsVisible(false); setTimeout(onClose, 300); }} style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', marginLeft: '0.5rem', display: 'flex' }}>
        <X size={16} />
      </button>
    </div>
  );

  return document.body ? createPortal(toastElement, document.body) : null;
}

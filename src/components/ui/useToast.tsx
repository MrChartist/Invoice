import { useCallback, useState } from 'react';
import { Toast, type ToastTone } from './Toast';

interface ToastData {
  key: number;
  message: string;
  tone: ToastTone;
}

/**
 * One-liner toasts for pages:
 *   const { notify, toastNode } = useToast();
 *   notify('Saved'); notify('Could not save', 'error');
 *   … render {toastNode}
 */
export function useToast() {
  const [toast, setToast] = useState<ToastData | null>(null);

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    setToast({ key: Date.now(), message, tone });
  }, []);

  const toastNode = toast ? (
    <Toast key={toast.key} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
  ) : null;

  return { notify, toastNode };
}

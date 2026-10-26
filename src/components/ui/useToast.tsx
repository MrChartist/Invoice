import { useCallback, useState } from 'react';
import { Toast, type ToastProps, type ToastTone } from './Toast';

interface ToastData {
  key: number;
  message: string;
  tone: ToastTone;
  action?: ToastProps['action'];
  duration?: number;
}

/**
 * One-liner toasts for pages:
 *   const { notify, toastNode } = useToast();
 *   notify('Saved'); notify('Could not save', 'error');
 *   … render {toastNode}
 */
export function useToast() {
  const [toast, setToast] = useState<ToastData | null>(null);

  const notify = useCallback(
    (message: string, tone: ToastTone = 'success', opts: { action?: ToastData['action']; duration?: number } = {}) => {
      setToast({ key: Date.now(), message, tone, ...opts });
    },
    [],
  );

  const toastNode = toast ? (
    <Toast key={toast.key} message={toast.message} tone={toast.tone} action={toast.action} duration={toast.duration} onClose={() => setToast(null)} />
  ) : null;

  return { notify, toastNode };
}

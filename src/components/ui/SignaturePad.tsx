import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import styles from './SignaturePad.module.css';

export interface SignaturePadHandle {
  /** PNG data URL of the drawing, or undefined when nothing was drawn. */
  toDataUrl: () => string | undefined;
  clear: () => void;
}

/**
 * Finger / pen / mouse signature canvas, shared by the quote acceptance (8.101) and the receiver
 * signature (R3-C2) dialogs. Extracted from `AcceptQuoteDialog` without behaviour change: the stroke
 * colour follows the canvas text colour, the canvas is sized to its box × devicePixelRatio when it mounts.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { label: string; onInk?: (inked: boolean) => void; className?: string }>(
  function SignaturePad({ label, onInk, className }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const inked = useRef(false);

    useEffect(() => {
      const c = canvas.current;
      if (!c) return;
      const ratio = window.devicePixelRatio || 1;
      c.width = c.clientWidth * ratio;
      c.height = c.clientHeight * ratio;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = getComputedStyle(c).color || 'black';
    }, []);

    const setInk = (v: boolean) => {
      if (inked.current === v) return;
      inked.current = v;
      onInk?.(v);
    };

    useImperativeHandle(ref, () => ({
      toDataUrl: () => (inked.current ? canvas.current?.toDataURL('image/png') : undefined),
      clear: () => {
        const c = canvas.current;
        c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
        setInk(false);
      },
    }));

    const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ctx = e.currentTarget.getContext('2d');
      if (!ctx) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drawing.current = true;
      const [x, y] = point(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      const ctx = e.currentTarget.getContext('2d');
      if (!ctx) return;
      const [x, y] = point(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      setInk(true);
    };
    const up = () => {
      drawing.current = false;
    };

    return (
      <canvas
        ref={canvas}
        className={className ? `${styles.pad} ${className}` : styles.pad}
        aria-label={label}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        data-signature-pad
      />
    );
  },
);

export default SignaturePad;

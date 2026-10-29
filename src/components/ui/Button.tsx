import { cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';

/**
 * The Mr Chartist button (docs/theme/BUTTON-SYSTEM.md §10): pick the kind, the intent and the size; the shape, finish,
 * states and motion come from src/styles/buttons.css. Never pass your own background, border, radius or shadow.
 *
 *   <Button>Save</Button>                                   secondary, default size, capsule
 *   <Button variant="primary" size="lg">Issue invoice</Button>   big: rounded rectangle
 *   <Button variant="danger">Delete</Button>                 destructive actions (the loss-red "sell" style)
 *   <Button size="sm" asChild><Link to="/clients">Clients</Link></Button>
 *   <Button size="icon" aria-label="Search"><Search /></Button>
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'glass' | 'buy' | 'sell' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'stack' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width: a rounded rectangle. */
  full?: boolean;
  /** A rectangle beside an input or in a long bar (§4). */
  rect?: boolean;
  /** Shows a turning ring instead of the label; the width does not change. */
  loading?: boolean;
  /** Render the single child (a `<Link>` or `<a>`) with the button's classes instead of a `<button>`. */
  asChild?: boolean;
  children?: ReactNode;
}

/** The class list for a button (kind + intent + size + shape). */
function buttonClass({ variant = 'secondary', size = 'md', full, rect }: Pick<ButtonProps, 'variant' | 'size' | 'full' | 'rect'> = {}): string {
  const out = ['btn'];
  if (variant !== 'secondary') out.push(variant);
  if (size === 'icon') out.push('icon');
  else if (size !== 'md') out.push(size);
  if (full) out.push('full');
  if (rect) out.push('rect');
  return out.join(' ');
}

export function Button({ variant, size, full, rect, loading, asChild, className, children, type, ...rest }: ButtonProps) {
  const cls = [buttonClass({ variant, size, full, rect }), className].filter(Boolean).join(' ');
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>;
    return cloneElement(child, { className: [cls, child.props.className].filter(Boolean).join(' ') });
  }
  return (
    <button type={type ?? 'button'} className={cls} aria-busy={loading || undefined} {...rest}>
      {children}
    </button>
  );
}

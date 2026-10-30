/**
 * Offline initials avatar. Replaces the old external avatar service — this app
 * must not make network calls, and a placeholder image is not worth one.
 */
import { initialsOf } from '../../lib/initials';
import { cn } from '../../lib/utils';
import styles from '../../styles/surface.module.css';

/** Icon-tile colours in a fixed order (IOS-UI.md 1.13): the same in every theme, white initials at 3:1 or more. */
const PALETTE = ['blue', 'green', 'indigo', 'orange', 'pink', 'purple', 'teal', 'red', 'brown', 'cyan'].map((c) => `var(--sys-${c}-tile)`);

/** Stable colour per name so the same client always looks the same. */
function colourOf(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  return PALETTE[hash % PALETTE.length];
}

export interface AvatarProps {
  name: string;
  size?: number;
  /** Rounded square (icon-tile shape) instead of a circle. */
  square?: boolean;
  /** Optional image (a profile logo) shown instead of the initials. */
  src?: string;
}

export function Avatar({ name, size = 36, square, src }: AvatarProps) {
  const label = name?.trim() || 'Unknown';

  return (
    <div
      aria-hidden="true"
      className={cn(styles.avatar, square && styles.avatarSquare, src && styles.avatarImage)}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.38)), ...(src ? undefined : { background: colourOf(label) }) }}
    >
      {src ? <img src={src} alt="" /> : initialsOf(label)}
    </div>
  );
}

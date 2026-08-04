/**
 * Offline initials avatar. Replaces the old external avatar service — this app
 * must not make network calls, and a placeholder image is not worth one.
 */

const PALETTE = [
  '#f07020', '#6366f1', '#25a05a', '#0ea5e9', '#ec4899',
  '#8b5cf6', '#e69a06', '#0f766e', '#d946ef', '#475569',
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable colour per name so the same client always looks the same. */
function colourOf(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  return PALETTE[hash % PALETTE.length];
}

export interface AvatarProps {
  name: string;
  size?: number;
  /** Square with rounded corners instead of a circle. */
  square?: boolean;
  /** Optional image (a profile logo) shown instead of the initials. */
  src?: string;
}

export function Avatar({ name, size = 36, square, src }: AvatarProps) {
  const label = name?.trim() || 'Unknown';
  const colour = colourOf(label);

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: square ? Math.max(6, size * 0.22) : '50%',
        background: src ? 'var(--card-inner)' : `linear-gradient(135deg, ${colour}, ${colour}c0)`,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: Math.max(10, size * 0.38),
        letterSpacing: '-0.02em',
        overflow: 'hidden',
        border: '1px solid var(--border)',
      }}
    >
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        initialsOf(label)
      )}
    </div>
  );
}

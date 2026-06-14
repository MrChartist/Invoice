import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FileText, ArrowRightLeft, Users, Settings as SettingsIcon,
  Sun, Moon, Monitor, Plus, Search, CornerDownLeft,
} from 'lucide-react';
import { setThemeMode } from '../../lib/theme';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ size?: number }>;
  run: () => void;
  keywords?: string;
}

/**
 * Global ⌘K / Ctrl+K command palette.
 * Also wires the "n" shortcut for a new invoice (when not typing in a field).
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(() => {
    const go = (path: string) => () => { navigate(path); setOpen(false); };
    const theme = (mode: 'light' | 'dark' | 'system') => () => { setThemeMode(mode); setOpen(false); };
    return [
      { id: 'new', label: 'New Invoice', hint: 'N', icon: Plus, run: go('/invoice'), keywords: 'create add' },
      { id: 'dashboard', label: 'Go to Dashboard', icon: LayoutDashboard, run: go('/'), keywords: 'home' },
      { id: 'transactions', label: 'Go to Transactions', icon: ArrowRightLeft, run: go('/transactions'), keywords: 'ledger invoices payments' },
      { id: 'invoice', label: 'Go to Invoice Creator', icon: FileText, run: go('/invoice'), keywords: 'create' },
      { id: 'clients', label: 'Go to Clients', icon: Users, run: go('/clients'), keywords: 'crm contacts' },
      { id: 'settings', label: 'Go to Settings', icon: SettingsIcon, run: go('/settings'), keywords: 'profile preferences' },
      { id: 'theme-light', label: 'Theme: Light', icon: Sun, run: theme('light'), keywords: 'appearance mode' },
      { id: 'theme-dark', label: 'Theme: Dark', icon: Moon, run: theme('dark'), keywords: 'appearance mode' },
      { id: 'theme-system', label: 'Theme: System', icon: Monitor, run: theme('system'), keywords: 'appearance mode auto' },
    ];
  }, [navigate]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c => `${c.label} ${c.keywords || ''}`.toLowerCase().includes(q));
  }, [commands, query]);

  // Global hotkeys
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      const tag = node?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node?.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        return;
      }
      if (!open && e.key.toLowerCase() === 'n' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        navigate('/invoice');
      }
    };
    const openEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-command-palette', openEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-command-palette', openEvent);
    };
  }, [open, navigate]);

  // Reset + focus when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); results[active]?.run(); }
  };

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh', animation: 'fadeIn 150ms ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: '100%', maxWidth: '560px', background: 'var(--popover)',
          border: '1px solid var(--border)', borderRadius: '16px',
          boxShadow: 'var(--shadow-xl)', overflow: 'hidden', animation: 'scaleIn 180ms ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <Search size={18} color="var(--muted-foreground)" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            placeholder="Type a command or search…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--foreground)', fontSize: '1rem' }}
          />
          <kbd style={{ fontSize: '0.6875rem', color: 'var(--muted-foreground)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.1rem 0.4rem', fontFamily: 'var(--font-mono)' }}>ESC</kbd>
        </div>

        <div style={{ maxHeight: '320px', overflowY: 'auto', padding: '0.5rem' }}>
          {results.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
              No commands found
            </div>
          ) : results.map((c, idx) => {
            const Icon = c.icon;
            const isActive = idx === active;
            return (
              <button
                key={c.id}
                onMouseEnter={() => setActive(idx)}
                onClick={() => c.run()}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.75rem 0.875rem', borderRadius: '10px', border: 'none', textAlign: 'left',
                  background: isActive ? 'var(--accent)' : 'transparent',
                  color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                  cursor: 'pointer', fontSize: '0.9375rem', fontWeight: 500,
                }}
              >
                <Icon size={17} />
                <span style={{ flex: 1, color: 'var(--foreground)' }}>{c.label}</span>
                {c.hint && <kbd style={{ fontSize: '0.6875rem', color: 'var(--muted-foreground)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.1rem 0.4rem', fontFamily: 'var(--font-mono)' }}>{c.hint}</kbd>}
                {isActive && <CornerDownLeft size={14} color="var(--muted-foreground)" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

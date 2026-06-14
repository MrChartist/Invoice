import { useState } from 'react';
import { login, getUser, verifyPin } from '../lib/auth';
import { FileText, Lock, User, ArrowRight } from 'lucide-react';
import { resolveTheme, getAccent } from '../lib/theme';

interface LoginPageProps {
  onSuccess: () => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const existingUser = getUser();
  const [mode] = useState<'login' | 'register'>(existingUser ? 'login' : 'register');
  const [name, setName] = useState(existingUser?.name || '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  // ── Theme-aware palette ──
  const isDark = resolveTheme() === 'dark';
  const accent = getAccent();
  const accentGrad = `linear-gradient(135deg, ${accent.primary}, ${accent.hover})`;
  const accentRing = `${accent.primary}80`; // ~50% alpha
  const c = {
    bg: isDark
      ? 'linear-gradient(145deg, #0a0f1c 0%, #111827 50%, #0a0f1c 100%)'
      : 'linear-gradient(145deg, #f5f3f0 0%, #faf9f7 50%, #eef1f5 100%)',
    card: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)',
    cardBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    heading: isDark ? '#fff' : '#1a1612',
    sub: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(26,22,18,0.55)',
    label: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(26,22,18,0.6)',
    inputBg: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    inputBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
    inputText: isDark ? '#fff' : '#1a1612',
    iconMuted: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(26,22,18,0.35)',
    footer: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(26,22,18,0.35)',
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (!name.trim()) { setError('Please enter your name'); return; }
      if (pin.length < 4) { setError('PIN must be at least 4 digits'); return; }
      const ok = login(name, pin);
      if (ok) onSuccess();
      else setError('Failed to create account');
    } else {
      if (!verifyPin(pin)) { setError('Incorrect PIN. Try again.'); return; }
      // Re-set the session (refresh timestamp)
      login(existingUser!.name, pin);
      onSuccess();
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px 14px 14px 40px',
    background: c.inputBg, border: `1px solid ${c.inputBorder}`,
    borderRadius: '12px', color: c.inputText, fontSize: '0.9375rem',
    outline: 'none', transition: 'border 150ms ease', boxSizing: 'border-box',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: c.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-body)',
      padding: '2rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: c.card,
        backdropFilter: 'blur(20px)',
        border: `1px solid ${c.cardBorder}`,
        borderRadius: '20px',
        padding: '48px 40px',
        boxShadow: isDark ? '0 24px 60px rgba(0,0,0,0.4)' : '0 24px 60px rgba(0,0,0,0.12)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '16px',
            background: accentGrad,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', boxShadow: `0 8px 24px ${accent.primary}4d`,
          }}>
            <FileText size={32} color="#fff" />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: c.heading, fontFamily: 'var(--font-display)', letterSpacing: '-0.03em', margin: 0 }}>
            MrChartist
          </h1>
          <p style={{ color: c.sub, fontSize: '0.875rem', marginTop: '6px' }}>
            Premium Invoice Creator
          </p>
        </div>

        {/* Welcome text */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          {mode === 'register' ? (
            <>
              <h2 style={{ color: c.heading, fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px 0' }}>Create Your Account</h2>
              <p style={{ color: c.sub, fontSize: '0.8125rem', margin: 0 }}>Your data stays 100% on this device</p>
            </>
          ) : (
            <>
              <h2 style={{ color: c.heading, fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px 0' }}>Welcome back, {existingUser?.name}</h2>
              <p style={{ color: c.sub, fontSize: '0.8125rem', margin: 0 }}>Enter your PIN to continue</p>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {mode === 'register' && (
            <div>
              <label style={{ display: 'block', color: c.label, fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' }}>
                Full Name
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: c.iconMuted }} />
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Rohit Singh"
                  autoFocus
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = accentRing}
                  onBlur={e => e.target.style.borderColor = c.inputBorder}
                />
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', color: c.label, fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' }}>
              {mode === 'register' ? 'Create a 4-digit PIN' : 'Enter PIN'}
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: c.iconMuted }} />
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
                maxLength={6}
                autoFocus={mode === 'login'}
                style={{ ...inputStyle, fontSize: '1.25rem', letterSpacing: '0.3em' }}
                onFocus={e => e.target.style.borderColor = accentRing}
                onBlur={e => e.target.style.borderColor = c.inputBorder}
              />
            </div>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', color: '#ef4444', fontSize: '0.8125rem', fontWeight: 500 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              width: '100%', padding: '16px',
              background: accentGrad,
              border: 'none', borderRadius: '12px',
              color: '#fff', fontSize: '1rem', fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              boxShadow: `0 4px 16px ${accent.primary}4d`,
              transition: 'all 150ms ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 8px 24px ${accent.primary}66`)}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = `0 4px 16px ${accent.primary}4d`)}
          >
            {mode === 'register' ? 'Create Account' : 'Unlock'} <ArrowRight size={18} />
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '32px', color: c.footer, fontSize: '0.6875rem' }}>
          🔒 Your data never leaves this device. Zero backend. Zero tracking.
        </p>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { login, getUser, verifyPin } from '../lib/auth';
import { FileText, Lock, User, ArrowRight } from 'lucide-react';

interface LoginPageProps {
  onSuccess: () => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const existingUser = getUser();
  const [mode] = useState<'login' | 'register'>(existingUser ? 'login' : 'register');
  const [name, setName] = useState(existingUser?.name || '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

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

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(145deg, #0a0f1c 0%, #111827 50%, #0a0f1c 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-body)',
      padding: '2rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '20px',
        padding: '48px 40px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '16px',
            background: 'linear-gradient(135deg, #f07020, #f09040)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', boxShadow: '0 8px 24px rgba(240,112,32,0.3)',
          }}>
            <FileText size={32} color="#fff" />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-display)', letterSpacing: '-0.03em', margin: 0 }}>
            MrChartist
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.875rem', marginTop: '6px' }}>
            Premium Invoice Creator
          </p>
        </div>

        {/* Welcome text */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          {mode === 'register' ? (
            <>
              <h2 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px 0' }}>Create Your Account</h2>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8125rem', margin: 0 }}>Your data stays 100% on this device</p>
            </>
          ) : (
            <>
              <h2 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px 0' }}>Welcome back, {existingUser?.name}</h2>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8125rem', margin: 0 }}>Enter your PIN to continue</p>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {mode === 'register' && (
            <div>
              <label style={{ display: 'block', color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' }}>
                Full Name
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)' }} />
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Rohit Singh"
                  autoFocus
                  style={{
                    width: '100%', padding: '14px 14px 14px 40px',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px', color: '#fff', fontSize: '0.9375rem',
                    outline: 'none', transition: 'border 150ms ease', boxSizing: 'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(240,112,32,0.5)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' }}>
              {mode === 'register' ? 'Create a 4-digit PIN' : 'Enter PIN'}
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)' }} />
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
                maxLength={6}
                autoFocus={mode === 'login'}
                style={{
                  width: '100%', padding: '14px 14px 14px 40px',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px', color: '#fff', fontSize: '1.25rem', letterSpacing: '0.3em',
                  outline: 'none', transition: 'border 150ms ease', boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(240,112,32,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
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
              background: 'linear-gradient(135deg, #f07020, #f09040)',
              border: 'none', borderRadius: '12px',
              color: '#fff', fontSize: '1rem', fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              boxShadow: '0 4px 16px rgba(240,112,32,0.3)',
              transition: 'all 150ms ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 8px 24px rgba(240,112,32,0.4)')}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(240,112,32,0.3)')}
          >
            {mode === 'register' ? 'Create Account' : 'Unlock'} <ArrowRight size={18} />
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '32px', color: 'rgba(255,255,255,0.25)', fontSize: '0.6875rem' }}>
          🔒 Your data never leaves this device. Zero backend. Zero tracking.
        </p>
      </div>
    </div>
  );
}

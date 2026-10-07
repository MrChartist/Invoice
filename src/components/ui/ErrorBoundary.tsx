import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { LogoMark } from '../brand/Logo';
import controls from '../../styles/controls.module.css';

interface State {
  error: Error | null;
}

/** Last line of defence: a render crash shows a recovery screen, never a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '1.5rem',
          background: 'var(--background)',
          color: 'var(--foreground)',
        }}
      >
        <div style={{ maxWidth: 440, textAlign: 'center', display: 'grid', gap: '1rem', justifyItems: 'center' }}>
          <LogoMark size={52} tile />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem', margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.6 }}>
            Your saved invoices are safe in this browser. Reload the page to continue.
          </p>
          <code
            style={{
              fontSize: '0.75rem',
              color: 'var(--muted-foreground)',
              background: 'var(--card-inner)',
              padding: '0.5rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {this.state.error.message}
          </code>
          <button type="button" className={controls.btnPrimary} onClick={() => window.location.reload()}>
            <RefreshCw size={16} /> Reload
          </button>
        </div>
      </div>
    );
  }
}

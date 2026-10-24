import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { can, deniedMessage, type AccessAction } from '../../lib/access';

/** Router state carried by a refused route; DashboardLayout shows it as a toast. */
export interface DeniedState {
  denied?: string;
}

/**
 * Route guard for local roles (6.21): renders `children` when the signed-in user may do `action`,
 * otherwise redirects to `fallback` with a message. Convenience, not security (see access.ts).
 */
export function RequireAccess({ action, fallback = '/', children }: { action: AccessAction; fallback?: string; children: ReactNode }) {
  if (can(action)) return <>{children}</>;
  const state: DeniedState = { denied: deniedMessage(action) };
  return <Navigate to={fallback} replace state={state} />;
}

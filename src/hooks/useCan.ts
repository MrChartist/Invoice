import { currentActor, roleCan, type AccessAction, type Actor, type Role } from '../lib/access';

export interface Access {
  /** May the signed-in user do `action`? */
  can: (action: AccessAction) => boolean;
  role: Role;
  actor: Actor | null;
}

/**
 * Role checks for screens (6.21). The signed-in user only changes at the PIN screen, which
 * unmounts the whole shell, so reading it on each render is enough. Convenience access control on
 * a shared device, not security: see src/lib/access.ts.
 */
export function useCan(): Access {
  const actor = currentActor();
  const role: Role = actor?.role ?? 'owner';
  return { can: (action: AccessAction) => roleCan(role, action), role, actor };
}

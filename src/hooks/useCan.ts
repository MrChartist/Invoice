import { currentActor, currentRole, roleCan, type AccessAction, type Actor, type Role } from '../lib/access';

export interface Access {
  /** May the signed-in user do `action`? */
  can: (action: AccessAction) => boolean;
  role: Role;
  actor: Actor | null;
}

/**
 * Role checks for screens (6.21). The signed-in user only changes at the PIN screen, which
 * unmounts the whole shell (App also remounts it when the user's role changes in another tab, and
 * locks it when the user is removed), so reading it on each render is enough. Convenience access control on
 * a shared device, not security: see src/lib/access.ts.
 */
export function useCan(): Access {
  const actor = currentActor();
  const role: Role = currentRole();
  return { can: (action: AccessAction) => roleCan(role, action), role, actor };
}

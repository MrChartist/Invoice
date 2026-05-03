/**
 * Simple localStorage-based auth for the Invoice Creator.
 * No backend — everything stays local.
 */

const AUTH_KEY = 'mrchartist_inv_auth';

export interface AuthUser {
  name: string;
  pin: string; // Stored as plain text (local-only, no server)
  createdAt: string;
}

/** Check if a user is currently logged in */
export function isAuthenticated(): boolean {
  try {
    const session = localStorage.getItem(AUTH_KEY);
    if (!session) return false;
    const user = JSON.parse(session) as AuthUser;
    return !!user.name && !!user.pin;
  } catch {
    return false;
  }
}

/** Get the currently logged-in user */
export function getUser(): AuthUser | null {
  try {
    const session = localStorage.getItem(AUTH_KEY);
    if (!session) return null;
    return JSON.parse(session) as AuthUser;
  } catch {
    return null;
  }
}

/** Register and log in a new user */
export function login(name: string, pin: string): boolean {
  if (!name.trim() || !pin.trim() || pin.length < 4) return false;
  const user: AuthUser = { name: name.trim(), pin, createdAt: new Date().toISOString() };
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  return true;
}

/** Verify PIN for an existing user */
export function verifyPin(pin: string): boolean {
  const user = getUser();
  if (!user) return false;
  return user.pin === pin;
}

/** Log out the current user (does NOT delete data) */
export function logout(): void {
  localStorage.removeItem(AUTH_KEY);
}

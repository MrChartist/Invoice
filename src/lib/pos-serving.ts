/**
 * PENDING 12 (SV-A): the services queue's "Now serving" token on the POS customer display. The queue view posts a
 * `serving` message on the display's BroadcastChannel; the display (`CustomerDisplay.tsx`) shows it over whatever bill
 * message it shows. Kept apart from `pos-display.ts` (and with its own copy of the channel name, equal by test) so that
 * module stays a small lazy leaf. Pure.
 */
export const SERVING_CHANNEL = 'mrchartist-pos-display';

export interface ServingMessage { v: 1; type: 'serving'; token: number | null }

const token = (n: unknown): number | null => (Number.isInteger(n) && (n as number) > 0 && (n as number) < 100000 ? (n as number) : null);

/** The queue's called token (anything not a token 1–99999 clears the line). */
export const servingMessage = (n: unknown): ServingMessage => ({ v: 1, type: 'serving', token: token(n) });

/** A received message as a serving token (null clears); undefined when it is not a serving message. */
export function readServing(raw: unknown): number | null | undefined {
  const m = raw as Partial<ServingMessage> | null;
  return m && typeof m === 'object' && m.v === 1 && m.type === 'serving' ? token(m.token) : undefined;
}

/** A display (re)opened and asks for the current state. */
export const isHello = (raw: unknown): boolean => !!raw && typeof raw === 'object' && (raw as { v?: unknown }).v === 1 && (raw as { type?: unknown }).type === 'hello';

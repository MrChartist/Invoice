/**
 * Getting-started checklist v2 (8H): what a new business still has to do, derived from facts the
 * Dashboard can read cheaply. Pure (unit-tested in tests/onboarding.test.ts).
 *
 * R6-A1 (v3): with a context (`buildChecklist(facts, ctx)`) the steps follow the business type, packs, modules and
 * role (catalogue in `checklist-steps.ts`). Without one it returns the v2 seven steps, unchanged.
 */
import { allSteps, cardSteps, type ChecklistCtx, type ChecklistFactsV3, type ChecklistStepV3, type SetupProgress } from './checklist-steps';

export type ChecklistId = 'profile' | 'client' | 'item' | 'invoice' | 'whatsapp' | 'payment' | 'backup';

export interface ChecklistFacts {
  profileReady: boolean;
  clients: number;
  items: number;
  invoices: number;
  /** Reminder / share log entries other than snoozes (a message was sent from the app). */
  messagesSent: number;
  payments: number;
  /** ISO time of the last backup on this device ('' / undefined = never). */
  lastBackup?: string;
}

export interface ChecklistStep {
  id: ChecklistId;
  done: boolean;
  to: string;
}

export function buildChecklist(f: ChecklistFacts): ChecklistStep[];
export function buildChecklist(f: ChecklistFactsV3, ctx: ChecklistCtx, progress?: SetupProgress): ChecklistStepV3[];
export function buildChecklist(f: ChecklistFactsV3, ctx?: ChecklistCtx, progress?: SetupProgress): ChecklistStep[] | ChecklistStepV3[] {
  if (ctx) return cardSteps(allSteps(f, ctx, progress));
  return [
    { id: 'profile', done: f.profileReady, to: '/settings' },
    { id: 'client', done: f.clients > 0, to: '/clients?new=1' },
    { id: 'item', done: f.items > 0, to: '/settings?tab=items' },
    { id: 'invoice', done: f.invoices > 0, to: '/invoice' },
    { id: 'whatsapp', done: f.messagesSent > 0, to: '/transactions' },
    { id: 'payment', done: f.payments > 0, to: '/transactions?filter=unpaid&pay=1' },
    { id: 'backup', done: !!f.lastBackup, to: '/settings?tab=data' },
  ];
}

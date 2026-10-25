/**
 * Maker-checker for the purchase side (8.44): supplier bills, expenses and supplier payments.
 * The small part the data layer needs — `purchasesDb.save` calls `assertBillApproval` once.
 *
 * Policy (key `purchase_approval_policy`, backed up like any data key; off by default):
 * bills / expenses above ₹X (0 = all) and supplier payments above ₹Y (0 = all) that a user who may
 * not approve (`doc.approve`: a clerk) records need the owner's approval. A held bill waits in
 * `purchase_drafts` (out of the books) and the owner posts it from the approvals queue; a held
 * payment waits in `payment_requests`. Single-user installs (nobody signed in = owner) never hold.
 * Payments recorded from a bank statement, a cleared cheque or a confirmed e-payment file are exempt:
 * the money has already left the bank (like the POS counter for sales).
 */

import type { PurchaseRecord } from '../types/purchases';
import { can } from './access';
import { ApprovalRequiredError } from './approval-gate';
import { DB_PREFIX, getJson } from './storage';

export const PURCHASE_APPROVAL_POLICY_KEY = `${DB_PREFIX}purchase_approval_policy`;

export interface PurchaseApprovalPolicy {
  bills: boolean;
  /** Bills / expenses above this rupee value need approval (0 = every one). */
  billAbove: number;
  payments: boolean;
  /** Supplier payments above this rupee value need approval (0 = every one). */
  paymentAbove: number;
}

export const DEFAULT_PURCHASE_POLICY: PurchaseApprovalPolicy = { bills: false, billAbove: 50000, payments: false, paymentAbove: 50000 };

const amt = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

export function readPurchaseApprovalPolicy(): PurchaseApprovalPolicy {
  const raw = getJson<Partial<PurchaseApprovalPolicy> | null>(PURCHASE_APPROVAL_POLICY_KEY, null);
  if (!raw || typeof raw !== 'object') return DEFAULT_PURCHASE_POLICY;
  return {
    bills: raw.bills === true,
    billAbove: amt(raw.billAbove, DEFAULT_PURCHASE_POLICY.billAbove),
    payments: raw.payments === true,
    paymentAbove: amt(raw.paymentAbove, DEFAULT_PURCHASE_POLICY.paymentAbove),
  };
}

const over = (value: number, above: number) => above <= 0 || value > above + 0.004;

type GateBill = Pick<PurchaseRecord, 'total'> & Partial<Pick<PurchaseRecord, 'branch_transfer_id'>>;

/**
 * Pure: does saving `bill` (over `stored`, the version in `purchases` if any) need approval? New bills
 * above the threshold, and edits that change the value of a bill so it ends above the threshold.
 * Sec 25(4) branch-transfer bills are system pairs and exempt.
 */
export function billApprovalRequired(bill: GateBill, stored: GateBill | undefined, policy: PurchaseApprovalPolicy, saverCanApprove: boolean): boolean {
  if (!policy.bills || saverCanApprove || bill.branch_transfer_id) return false;
  const value = Math.abs(Number(bill.total) || 0);
  if (stored && Math.abs(value - Math.abs(Number(stored.total) || 0)) <= 0.004) return false;
  return over(value, policy.billAbove);
}

/** Pure: does a supplier payment of `amount` started in the app need approval? */
export function paymentApprovalRequired(amount: number, policy: PurchaseApprovalPolicy, saverCanApprove: boolean): boolean {
  if (!policy.payments || saverCanApprove) return false;
  return over(Math.abs(Number(amount) || 0), policy.paymentAbove);
}

/** The data layer's single branch (purchasesDb.save): refuse a bill that should have been sent for approval. */
export function assertBillApproval(bill: GateBill & Pick<PurchaseRecord, 'bill_number'>, stored: GateBill | undefined): void {
  if (!billApprovalRequired(bill, stored, readPurchaseApprovalPolicy(), can('doc.approve'))) return;
  throw new ApprovalRequiredError(`${bill.bill_number ? `Bill ${bill.bill_number}` : 'This bill'} needs the owner's approval: send it for approval from the bill form or the documents inbox.`);
}

/** Convenience for screens: would the signed-in user's payment of `amount` be held? */
export function paymentNeedsApproval(amount: number): boolean {
  return paymentApprovalRequired(amount, readPurchaseApprovalPolicy(), can('doc.approve'));
}

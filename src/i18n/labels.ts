/** Translated names for values that are stored in English (document types, statuses, methods, roles). */
import type { DocumentType } from '../types/invoice';
import type { Role } from '../lib/access';
import { t, tMaybe } from './index';

export const docLabel = (type: DocumentType): string => t(`doc.${type}`);

/** Invoice status; free-text labels (e.g. a quotation's "Accepted") pass through unchanged. */
export const statusLabel = (status: string): string => tMaybe('status.', status);

/** Payment method; the stored value stays English (it prints on receipts and exports). */
export const methodLabel = (method: string): string => tMaybe('method.', method);

export const roleLabel = (role: Role): string => t(`role.${role}`);

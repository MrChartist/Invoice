/**
 * Round 2, R2-A — the few collections strings the Receivables screen itself shows (tab, buttons, statement style).
 * Kept apart from the `collections` area so the Receivables route chunk does not share a chunk with the lazy
 * collections dialogs (every shared chunk is listed in the shell's preload map).
 */
import { defineArea } from '../area';

export const rcv2T = defineArea(
  {
    tabFollowups: 'Follow-ups',
    fuLog: 'Log follow-up',
    woBtn: 'Write off',
    rmNeverBadge: 'No reminders',
    rmManualBadge: 'Remind manually',
    stStyle: 'Style',
    stAgeing: 'Ageing strip',
    'st.balance_forward': 'Balance forward',
    'st.open_items': 'Open items',
    'st.transactions': 'Transactions',
  } as const,
  {
    tabFollowups: 'फ़ॉलो-अप',
    fuLog: 'फ़ॉलो-अप दर्ज करें',
    woBtn: 'बट्टे खाते डालें',
    rmNeverBadge: 'रिमाइंडर नहीं',
    rmManualBadge: 'मैन्युअल रिमाइंडर',
    stStyle: 'शैली',
    stAgeing: 'पुरानेपन की पट्टी',
    'st.balance_forward': 'आगे लाया शेष',
    'st.open_items': 'खुले बिल',
    'st.transactions': 'लेन-देन',
  },
);

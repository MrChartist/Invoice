import { useState } from 'react';
import { FlaskConical, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { demoStatus, loadDemoData, removeDemoData } from '../../lib/demo-data';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

interface Props {
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  /** Called after sample data was added or removed. Default: reload, so every page re-reads storage. */
  onChanged?: () => void;
}

const reload = () => setTimeout(() => window.location.reload(), 700);

/** "Try with sample data" / "Remove sample data", both behind a confirmation. */
export function SampleDataCard({ notify, onChanged }: Props) {
  const [status, setStatus] = useState(() => demoStatus());
  const [dialog, setDialog] = useState<'load' | 'remove' | null>(null);

  const refresh = () => setStatus(demoStatus());
  const done = () => {
    refresh();
    if (onChanged) onChanged();
    else reload();
  };

  const load = () => {
    setDialog(null);
    try {
      const r = loadDemoData({ confirm: status.realInvoices > 0 });
      if (!r.ok) {
        notify(r.reason === 'already_loaded' ? 'Sample data is already loaded.' : 'Sample data was not added.', 'info');
        refresh();
        return;
      }
      notify(`Sample data added: ${r.counts.invoices} invoices, ${r.counts.clients} clients. Reloading…`);
      done();
    } catch (err) {
      notify((err as Error).message || 'Could not add the sample data.', 'error');
      refresh();
    }
  };

  const remove = () => {
    setDialog(null);
    try {
      const gone = removeDemoData();
      notify(`Sample data removed (${gone.invoices} invoices). Your own records were not touched. Reloading…`);
      done();
    } catch (err) {
      notify((err as Error).message || 'Could not remove the sample data.', 'error');
      refresh();
    }
  };

  const hasReal = status.realInvoices > 0;
  return (
    <section className={surface.card} data-testid="sample-data-card">
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}>
          <FlaskConical size={16} /> Sample data
        </span>
        {status.loaded && <span className={surface.badge}>Demo data loaded</span>}
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>
          Fill the app with a fictional business so you can look around: about 25 invoices over six months, clients,
          items, purchases and a recurring schedule. Every sample record is tagged, and one click removes all of them
          without touching anything you entered yourself.
        </p>
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
          {status.loaded ? (
            <button type="button" className={controls.btnOutline} onClick={() => setDialog('remove')}>
              <Trash2 size={16} /> Remove sample data
            </button>
          ) : (
            <button type="button" className={controls.btnOutline} onClick={() => setDialog('load')}>
              <FlaskConical size={16} /> Try with sample data
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'load'}
        title="Add sample data?"
        message={
          hasReal
            ? `You already have ${status.realInvoices} invoice${status.realInvoices === 1 ? '' : 's'} of your own. The sample records will be added next to them, marked "demo", and your numbering will not change. You can remove them at any time.`
            : 'A fictional business with invoices, clients and purchases will be added. You can remove all of it later with one click.'
        }
        confirmLabel="Add sample data"
        onConfirm={load}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'remove'}
        destructive
        title="Remove sample data?"
        message={`This deletes the ${status.counts.invoices} sample invoices, ${status.counts.clients} clients and the other sample records. Anything you created yourself is kept.`}
        confirmLabel="Remove sample data"
        onConfirm={remove}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/useToast';
import { gwT } from '../../i18n/areas/gateway';
import { useT } from '../../i18n';
import { getGatewaySession, setGatewayPeriod, setVoucherDate, validatePeriod, isCalendarDay } from '../../lib/gateway/period';
import { GatewayContext, hasModal, type GatewayContextValue, type ScreenKeyHandler } from './context';
import controls from '../../styles/controls.module.css';
import { DateField } from '../ui/DateField';

type Dialog = null | 'date' | 'period';

const plain = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey;

/**
 * Frame of every Gateway screen: one capture-phase key listener (the active screen's handler first,
 * then the shared F2 / Alt+F2 / Go To keys), the date and period dialogs, and toasts.
 * Capture phase + preventDefault means the shell-wide hotkeys (useHotkeys / useTallyKeys, bubble
 * phase) never see a key a Gateway screen used.
 */
export function GatewayShell({ children }: { children: ReactNode }) {
  useT(); // re-render on language change
  const navigate = useNavigate();
  const location = useLocation();
  const { notify, toastNode } = useToast();
  const screenKeys = useRef<ScreenKeyHandler | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const setScreenKeys = useCallback((fn: ScreenKeyHandler | null) => {
    screenKeys.current = fn;
  }, []);
  const openDate = useCallback(() => setDialog('date'), []);
  const openPeriod = useCallback(() => setDialog('period'), []);
  const ctx = useMemo<GatewayContextValue>(() => ({ setScreenKeys, openDate, openPeriod, notify }), [setScreenKeys, openDate, openPeriod, notify]);

  // Keys routed here from elsewhere (F2 / Alt+F2 on another page navigate to /gateway with state).
  const tally = (location.state as { tally?: string } | null)?.tally;
  useEffect(() => {
    if (tally === 'date' || tally === 'period') {
      setDialog(tally);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [tally]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || hasModal()) return;
      if (screenKeys.current?.(e)) {
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'f2' && !e.shiftKey && plain(e)) {
        e.preventDefault();
        setDialog('date');
      } else if (k === 'f2' && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setDialog('period');
      } else if (k === 'g' && (e.altKey || e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        navigate('/gateway', { state: { tally: 'goto' } });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [navigate]);

  return (
    <GatewayContext.Provider value={ctx}>
      {children}
      {dialog === 'date' && <DateDialog onClose={() => setDialog(null)} />}
      {dialog === 'period' && <PeriodDialog onClose={() => setDialog(null)} />}
      {toastNode}
    </GatewayContext.Provider>
  );
}

function DateDialog({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(() => getGatewaySession().voucherDate);
  const [error, setError] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCalendarDay(date) || !setVoucherDate(date)) return setError(gwT('dateBad'));
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={gwT('dateTitle')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{gwT('cancel')}</button>
          <button type="submit" form="gw-date-form" className={controls.btnPrimary}>{gwT('apply')}</button>
        </>
      }
    >
      <form id="gw-date-form" onSubmit={submit} className={controls.field}>
        <label className={controls.label} htmlFor="gw-date">{gwT('dateLabel')}</label>
        <DateField id="gw-date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
        {error && <p className={controls.error} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

function PeriodDialog({ onClose }: { onClose: () => void }) {
  const initial = getGatewaySession().period;
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [error, setError] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validatePeriod({ start, end });
    if (problem) return setError(problem === 'order' ? gwT('periodBad') : gwT('dateBad'));
    setGatewayPeriod({ start, end });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={gwT('periodTitle')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{gwT('cancel')}</button>
          <button type="submit" form="gw-period-form" className={controls.btnPrimary}>{gwT('apply')}</button>
        </>
      }
    >
      <form id="gw-period-form" onSubmit={submit}>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="gw-from">{gwT('periodFrom')}</label>
            <DateField id="gw-from" className={controls.input} value={start} onChange={(e) => setStart(e.target.value)} autoFocus />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="gw-to">{gwT('periodTo')}</label>
            <DateField id="gw-to" className={controls.input} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

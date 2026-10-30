import { useMemo, useState } from 'react';
import { Plus, Save, Trash2, Wand2 } from 'lucide-react';
import { loadEmployees, loadPayrollSettings, loadRuns } from '../../lib/payroll/store';
import { loadArrears, loadPerquisites, savePerquisite } from '../../lib/payroll/depth-store';
import { deleteRelief89, loadRelief89, saveRelief89, savePtExtraStates } from '../../lib/payroll/followups-store';
import {
  accommodationPerquisite,
  carPerquisite,
  giftPerquisite,
  hotelPerquisite,
  mealsPerquisite,
  relief89,
  relief89Rows,
  relief89Suggest,
  rule3bAccretion,
  rule3bSuggest,
  type PerqValuation,
} from '../../lib/payroll/followups';
import { payrollGrantees, setPayrollGrant } from '../../lib/payroll/grants';
import { fyStartOfMonth, lastDayOfMonth } from '../../lib/payroll/statutory';
import { PT_STATES } from '../../lib/payroll-rules';
import { ROLE_LABELS } from '../../lib/access';
import { useCan } from '../../hooks/useCan';
import type { PerquisiteKind, Relief89Year, TaxRegime } from '../../types/payroll';
import { payrollT as pT } from '../../i18n/areas/payroll';
import { payrollMoreT as mT } from '../../i18n/areas/payroll-more';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { ActuarialPanel } from './ActuarialPanel';
import { Out } from './Out';
import { inr, parseAmount, runAction, type TabProps } from './shared';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

type YearRow = { fy: string; regime: TaxRegime; income: string; arrears: string };
const toRow = (y: Relief89Year): YearRow => ({ fy: String(y.fy), regime: y.regime, income: String(y.income), arrears: String(y.arrears) });
const n = (v: string) => parseAmount(v) ?? 0;

/** 7T: relief u/s 89 (Form 10E), Rule 3 perquisite valuation, actuarial valuations, PT on arrears, payroll access grants. */
export function MoreTab(props: TabProps) {
  return (
    <div className={styles.stack}>
      <ReliefPanel {...props} />
      <PerqPanel {...props} />
      <ActuarialPanel {...props} />
      <PtPanel {...props} />
      <AccessPanel {...props} />
    </div>
  );
}

/* ── Relief u/s 89(1) — Form 10E ──────────────────────────────── */

function ReliefPanel({ month, version, refresh, notify }: TabProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => loadRelief89(), [version]);
  const fy = Number(fyStartOfMonth(month).slice(0, 4));
  const fyText = `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
  const [empId, setEmpId] = useState('');
  const emp = employees.find((e) => e.id === (empId || employees[0]?.id));
  const [regime, setRegime] = useState<TaxRegime>('new');
  const [incomeWith, setIncomeWith] = useState('');
  const [years, setYears] = useState<YearRow[]>([]);
  const [apply, setApply] = useState(true);
  const yearsIn: Relief89Year[] = years.map((y) => ({ fy: Math.trunc(n(y.fy)), regime: y.regime, income: n(y.income), arrears: n(y.arrears) })).filter((y) => y.fy > 1990 && y.fy < fy);
  const result = emp ? relief89({ fy, regime, income_with: n(incomeWith), years: yearsIn, dob: emp.dob }) : null;

  const load = (id: string) => {
    setEmpId(id);
    const e = employees.find((x) => x.id === id);
    const s = saved.find((r) => r.employee_id === id && r.fy === fy);
    if (s) {
      setRegime(s.regime);
      setIncomeWith(String(s.income_with));
      setYears(s.years.map(toRow));
      setApply(s.apply_tds);
    } else {
      setRegime(e?.tax_regime === 'old' ? 'old' : 'new');
      setIncomeWith('');
      setYears([]);
    }
  };
  const suggest = () => {
    if (!emp) return;
    const s = relief89Suggest(emp, fy, loadRuns(), loadArrears());
    setRegime(emp.tax_regime === 'old' ? 'old' : 'new');
    setIncomeWith(String(s.income_with));
    setYears(s.years.length ? s.years.map(toRow) : [{ fy: String(fy - 1), regime: emp.tax_regime === 'old' ? 'old' : 'new', income: '', arrears: '' }]);
  };
  const setYear = (i: number, patch: Partial<YearRow>) => setYears(years.map((y, j) => (j === i ? { ...y, ...patch } : y)));
  const name = new Map(employees.map((e) => [e.id, `${e.code} · ${e.name}`]));

  return (
    <section className={surface.card}>
      <div className={surface.cardBody}>
        <h2 className={styles.h2}>{mT('r89.title')}</h2>
        <p className={styles.note}>{mT('r89.hint')}</p>
        <div className={styles.formGrid}>
          <label className={controls.field}>
            <span className={controls.label}>{pT('rep.employee')}</span>
            <SelectField className={controls.select} value={emp?.id ?? ''} onChange={(e) => load(e.target.value)}>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
            </SelectField>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{mT('r89.regime', { fy: fyText })}</span>
            <SelectField className={controls.select} value={regime} onChange={(e) => setRegime(e.target.value as TaxRegime)}>
              <option value="new">{mT('regime.new')}</option>
              <option value="old">{mT('regime.old')}</option>
            </SelectField>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{mT('r89.incomeWith')}</span>
            <input className={controls.inputNumeric} type="number" step="1" value={incomeWith} onChange={(e) => setIncomeWith(e.target.value)} />
          </label>
        </div>
        <div className={styles.inline}>
          <button type="button" className={controls.btnOutline} onClick={suggest} disabled={!emp}><Wand2 size={15} /> {mT('r89.suggest')}</button>
          <button type="button" className={controls.btnOutline} onClick={() => setYears([...years, { fy: String(fy - 1 - years.length), regime, income: '', arrears: '' }])}><Plus size={15} /> {mT('r89.addYear')}</button>
        </div>
        {years.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{mT('r89.years')}</caption>
              <thead><tr><th>{mT('r89.year')}</th><th>{mT('r89.regimeCol')}</th><th className={styles.num}>{mT('r89.income')}</th><th className={styles.num}>{mT('r89.arrears')}</th><th /></tr></thead>
              <tbody>
                {years.map((y, i) => (
                  <tr key={i}>
                    <td><input className={controls.inputNumeric} type="number" min="1990" max={fy - 1} aria-label={mT('r89.year')} value={y.fy} onChange={(e) => setYear(i, { fy: e.target.value })} /></td>
                    <td>
                      <SelectField className={controls.select} aria-label={mT('r89.regimeCol')} value={y.regime} onChange={(e) => setYear(i, { regime: e.target.value as TaxRegime })}>
                        <option value="new">{mT('regime.new')}</option>
                        <option value="old">{mT('regime.old')}</option>
                      </SelectField>
                    </td>
                    <td className={styles.num}><input className={controls.inputNumeric} type="number" aria-label={mT('r89.income')} value={y.income} onChange={(e) => setYear(i, { income: e.target.value })} /></td>
                    <td className={styles.num}><input className={controls.inputNumeric} type="number" min="0" aria-label={mT('r89.arrears')} value={y.arrears} onChange={(e) => setYear(i, { arrears: e.target.value })} /></td>
                    <td className={styles.num}><button type="button" className={controls.btnDanger} aria-label={mT('r89.removeYear', { fy: y.fy })} onClick={() => setYears(years.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result && yearsIn.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{mT('r89.working')}</caption>
              <thead><tr><th>{mT('r89.colFy')}</th><th className={styles.num}>{mT('r89.income')}</th><th className={styles.num}>{mT('r89.arrears')}</th><th className={styles.num}>{mT('r89.colWithout')}</th><th className={styles.num}>{mT('r89.colWith')}</th><th className={styles.num}>{mT('r89.colDiff')}</th></tr></thead>
              <tbody>
                <tr><td><strong>{result.receipt.label}</strong> {mT('r89.receipt')}</td><td className={styles.num}>{inr(result.receipt.income)}</td><td className={styles.num}>{inr(result.arrears_total)}</td><td className={styles.num}>{inr(result.receipt.tax_without)}</td><td className={styles.num}>{inr(result.receipt.tax_with)}</td><td className={styles.num}>{inr(result.difference_receipt)}</td></tr>
                {result.earlier.map((r) => (
                  <tr key={r.fy}><td>{r.label}</td><td className={styles.num}>{inr(r.income)}</td><td className={styles.num}>{inr(r.arrears)}</td><td className={styles.num}>{inr(r.tax_without)}</td><td className={styles.num}>{inr(r.tax_with)}</td><td className={styles.num}>{inr(r.difference)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className={styles.strong}>{mT('r89.result', { amount: inr(result.relief) })}</p>
            {result.notes.map((x) => <p key={x} className={styles.note}>{x}</p>)}
          </div>
        )}
        <label className={controls.check}><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> {mT('r89.apply')}</label>
        <div className={styles.inline}>
          <button
            type="button"
            className={controls.btnPrimary}
            disabled={!emp}
            onClick={() => emp && runAction(() => void saveRelief89({ employee_id: emp.id, fy, regime, income_with: n(incomeWith), years: yearsIn, apply_tds: apply }), refresh, notify, mT('r89.saved'))}
          >
            <Save size={15} /> {mT('r89.save')}
          </button>
          {emp && result && yearsIn.length > 0 && <Out base={`form10E-${emp.code}-FY${fyText}`} rows={() => relief89Rows(result, emp)} sheet="Form 10E" />}
        </div>
        {saved.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{mT('r89.list')}</caption>
              <thead><tr><th>{pT('rep.employee')}</th><th>{mT('r89.colFy')}</th><th className={styles.num}>{mT('r89.reliefCol')}</th><th>{mT('r89.tdsCol')}</th><th /></tr></thead>
              <tbody>
                {saved.map((r) => (
                  <tr key={r.id}>
                    <td><button type="button" className={controls.btnGhost} onClick={() => load(r.employee_id)}>{name.get(r.employee_id) ?? r.employee_id}</button></td>
                    <td>{r.fy}-{String((r.fy + 1) % 100).padStart(2, '0')}</td>
                    <td className={styles.num}>{inr(r.relief)}</td>
                    <td>{r.apply_tds ? mT('r89.inTds') : mT('r89.notInTds')}</td>
                    <td className={styles.num}><button type="button" className={controls.btnDanger} aria-label={mT('r89.delete', { name: name.get(r.employee_id) ?? '' })} onClick={() => runAction(() => deleteRelief89(r.id), refresh, notify, mT('r89.deleted'))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Rule 3 perquisite valuation ──────────────────────────────── */

const PERQ_KINDS = ['car', 'accommodation', 'hotel', 'meals', 'gift', 'accretion'] as const;
type CalcKind = (typeof PERQ_KINDS)[number];
const KIND_KEY = { car: 'ext.perq.car', accommodation: 'ext.perq.accommodation', hotel: 'ext.perq.hotel', meals: 'ext.perq.meals', gift: 'ext.perq.gift', accretion: 'ext.perq.accretion' } as const;
/** Calculator kind → stored perquisite kind (hotel is accommodation; accretion and gifts are one-off). */
const STORED: Record<CalcKind, PerquisiteKind> = { car: 'car', accommodation: 'accommodation', hotel: 'accommodation', meals: 'meals', gift: 'gift', accretion: 'accretion' };

function PerqPanel({ month, version, refresh, notify }: TabProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees(), [version]);
  const [empId, setEmpId] = useState('');
  const [kind, setKind] = useState<CalcKind>('car');
  const [f, setF] = useState<Record<string, string>>({ cc: '1500', use: 'mixed', running_by: 'employer', ownership: 'owned', population: '', chauffeur: '' });
  const [from, setFrom] = useState(month);
  const [to, setTo] = useState('');
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const date = lastDayOfMonth(from || month);
  const v: PerqValuation =
    kind === 'car'
      ? carPerquisite({ date, cc: n(f.cc ?? ''), use: (f.use as 'official' | 'private' | 'mixed') || 'mixed', running_by: f.running_by === 'employee' ? 'employee' : 'employer', chauffeur: f.chauffeur === '1', private_cost: n(f.private_cost ?? ''), recovered: n(f.recovered ?? '') })
      : kind === 'accommodation'
        ? accommodationPerquisite({ date, salary: n(f.salary ?? ''), ownership: f.ownership === 'leased' ? 'leased' : 'owned', population: n(f.population ?? ''), rent: n(f.rent ?? ''), furniture_cost: n(f.furniture_cost ?? ''), furniture_hire: n(f.furniture_hire ?? ''), recovered: n(f.recovered ?? '') })
        : kind === 'meals'
          ? mealsPerquisite({ date, meals: n(f.meals ?? ''), cost_per_meal: n(f.cost_per_meal ?? ''), recovered_per_meal: n(f.recovered_per_meal ?? '') })
          : kind === 'hotel'
            ? hotelPerquisite({ date, salary: n(f.salary ?? ''), charges: n(f.charges ?? ''), days: n(f.days ?? ''), on_transfer: f.on_transfer === '1', recovered: n(f.recovered ?? '') })
            : kind === 'accretion'
              ? rule3bAccretion({ date, pc: n(f.pc ?? ''), pc1: n(f.pc1 ?? ''), tp1: n(f.tp1 ?? ''), income: n(f.fund_income ?? ''), opening: n(f.opening ?? ''), closing: n(f.closing ?? '') })
              : giftPerquisite({ date, value: n(f.gift ?? ''), earlier_this_year: n(f.gift_earlier ?? '') });
  const oneOff = kind === 'gift' || kind === 'accretion';
  const num = (k: string, label: string) => (
    <label className={controls.field} key={k}>
      <span className={controls.label}>{label}</span>
      <input className={controls.inputNumeric} type="number" min="0" step="0.01" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const pick = (k: string, label: string, opts: [string, string][]) => (
    <label className={controls.field} key={k}>
      <span className={controls.label}>{label}</span>
      <SelectField className={controls.select} value={f[k] ?? opts[0][0]} onChange={(e) => set(k, e.target.value)}>
        {opts.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
      </SelectField>
    </label>
  );
  const employee = empId || employees[0]?.id || '';
  const save = () => {
    savePerquisite({ employee_id: employee, kind: STORED[kind], description: mT('perq.desc', { kind: pT(KIND_KEY[kind]) }), from_month: from, ...(oneOff ? { to_month: from } : to ? { to_month: to } : {}), monthly_value: v.monthly, basis: v.basis });
  };

  return (
    <section className={surface.card}>
      <div className={surface.cardBody}>
        <h2 className={styles.h2}>{mT('perq.title')}</h2>
        <p className={styles.note}>{mT('perq.hint')}</p>
        <div className={styles.formGrid}>
          <label className={controls.field}>
            <span className={controls.label}>{pT('rep.employee')}</span>
            <SelectField className={controls.select} value={employee} onChange={(e) => setEmpId(e.target.value)}>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
            </SelectField>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{pT('ext.perqKind')}</span>
            <SelectField className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as CalcKind)}>
              {PERQ_KINDS.map((k) => <option key={k} value={k}>{pT(KIND_KEY[k])}</option>)}
            </SelectField>
          </label>
          <label className={controls.field}><span className={controls.label}>{pT('ext.perqFrom')}</span><DateField className={controls.input} mode="month" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          {!oneOff && <label className={controls.field}><span className={controls.label}>{pT('ext.perqTo')}</span><DateField className={controls.input} mode="month" value={to} onChange={(e) => setTo(e.target.value)} /></label>}
        </div>
        <div className={styles.formGrid}>
          {kind === 'car' && [
            num('cc', mT('perq.cc')),
            pick('use', mT('perq.use'), [['mixed', mT('perq.useMixed')], ['official', mT('perq.useOfficial')], ['private', mT('perq.usePrivate')]]),
            ...(f.use === 'private'
              ? [num('private_cost', mT('perq.privateCost')), num('recovered', mT('perq.recovered'))]
              : f.use === 'official'
                ? []
                : [pick('running_by', mT('perq.runningBy'), [['employer', mT('perq.byEmployer')], ['employee', mT('perq.byEmployee')]]), pick('chauffeur', mT('perq.chauffeur'), [['', mT('no')], ['1', mT('yes')]])]),
          ]}
          {kind === 'accommodation' && [
            num('salary', mT('perq.salary')),
            pick('ownership', mT('perq.ownership'), [['owned', mT('perq.owned')], ['leased', mT('perq.leased')]]),
            f.ownership === 'leased' ? num('rent', mT('perq.rent')) : num('population', mT('perq.population')),
            num('furniture_cost', mT('perq.furnitureCost')),
            num('furniture_hire', mT('perq.furnitureHire')),
            num('recovered', mT('perq.recovered')),
          ]}
          {kind === 'meals' && [num('meals', mT('perq.meals')), num('cost_per_meal', mT('perq.costPerMeal')), num('recovered_per_meal', mT('perq.recoveredPerMeal'))]}
          {kind === 'gift' && [num('gift', mT('perq.gift')), num('gift_earlier', mT('perq.giftEarlier'))]}
          {kind === 'hotel' && [
            num('salary', mT('perq.salary')),
            num('charges', mT('perq.hotelCharges')),
            num('days', mT('perq.hotelDays')),
            pick('on_transfer', mT('perq.onTransfer'), [['', mT('no')], ['1', mT('yes')]]),
            num('recovered', mT('perq.recovered')),
          ]}
          {kind === 'accretion' && [
            num('pc', mT('perq.pc')),
            num('pc1', mT('perq.pc1')),
            num('tp1', mT('perq.tp1')),
            num('fund_income', mT('perq.fundIncome')),
            num('opening', mT('perq.opening')),
            num('closing', mT('perq.closing')),
          ]}
        </div>
        {kind === 'accretion' && (
          <button
            type="button"
            className={controls.btnOutline}
            disabled={!employee}
            onClick={() => {
              const x = rule3bSuggest(employee, Number(fyStartOfMonth(from || month).slice(0, 4)), loadRuns(), loadPerquisites());
              setF({ ...f, pc: String(x.pc), pc1: String(x.pc1), tp1: String(x.tp1) });
            }}
          >
            <Wand2 size={15} /> {mT('r89.suggest')}
          </button>
        )}
        <p className={styles.strong}>{oneOff ? mT('perq.valueOnce', { amount: inr(v.monthly) }) : mT('perq.value', { amount: inr(v.monthly) })}</p>
        <p className={styles.sub}>{v.basis}</p>
        <p className={styles.note}>{mT('perq.source', { source: v.source })}</p>
        <button type="button" className={controls.btnOutline} disabled={!employee || !(v.monthly > 0)} onClick={() => runAction(save, refresh, notify, pT('ext.perqSaved'))}>
          <Plus size={15} /> {mT('perq.save')}
        </button>
      </div>
    </section>
  );
}

/* ── PT on arrears / one-off items ────────────────────────────── */

function PtPanel({ version, refresh, notify }: TabProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => loadPayrollSettings().pt_extra_states ?? [], [version]);
  const [states, setStates] = useState<string[]>(initial);
  return (
    <section className={surface.card}>
      <div className={surface.cardBody}>
        <h2 className={styles.h2}>{mT('pt.title')}</h2>
        <p className={styles.note}>{mT('pt.hint')}</p>
        <div className={styles.checks}>
          {Object.entries(PT_STATES).map(([code, label]) => (
            <label key={code} className={controls.check}>
              <input type="checkbox" checked={states.includes(code)} onChange={(e) => setStates(e.target.checked ? [...states, code] : states.filter((s) => s !== code))} /> {label}
            </label>
          ))}
        </div>
        <button type="button" className={controls.btnOutline} onClick={() => runAction(() => void savePtExtraStates(states), refresh, notify, mT('pt.saved'))}>
          <Save size={15} /> {mT('pt.save')}
        </button>
      </div>
    </section>
  );
}

/* ── Per-user payroll access ──────────────────────────────────── */

function AccessPanel({ version, refresh, notify }: TabProps) {
  const { can } = useCan();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const users = useMemo(() => payrollGrantees(), [version]);
  const owner = can('security.manage');
  return (
    <section className={surface.card}>
      <div className={surface.cardBody}>
        <h2 className={styles.h2}>{mT('acc.title')}</h2>
        <p className={styles.note}>{mT('acc.hint')}</p>
        {!owner ? (
          <p className={styles.sub}>{mT('acc.ownerOnly')}</p>
        ) : users.length === 0 ? (
          <p className={styles.sub}>{mT('acc.none')}</p>
        ) : (
          <div className={styles.checks}>
            {users.map((u) => (
              <label key={u.id} className={controls.check}>
                <input
                  type="checkbox"
                  checked={u.granted}
                  onChange={(e) => {
                    const on = e.target.checked;
                    runAction(() => void setPayrollGrant(u.id, on), refresh, notify, on ? mT('acc.granted', { name: u.name }) : mT('acc.revoked', { name: u.name }));
                  }}
                />{' '}
                {u.name} <span className={styles.sub}>{ROLE_LABELS[u.role]}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

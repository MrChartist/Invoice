/**
 * AG-B5 dairy products: starter BOMs (typical yields — adjust) with the class rate suggested for today, made through the
 * existing manufacturing journal / production order; and a fat memo (kg fat in milk vs in products). Counter sales of
 * milk use the POS with the scale.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { bT } from '../../i18n/areas/agri-r12b';
import { addStarter, DAIRY_STARTERS, fatMemo, starterRate } from '../../lib/agri/ag-dairy-products';
import { todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { sm, useRun, wrap, type Done } from './dairy-kit';
import { N, Sel } from './dairy-ui';

export default function ProductsView({ onDone }: { onDone: Done }) {
  const [, run] = useRun(onDone);
  const [milk, setMilk] = useState<'cow' | 'buffalo'>('buffalo');
  const [m, setM] = useState({ litres: 200, fat: 6, qty: 40, pfat: 22 });
  const memo = fatMemo(m.litres, m.fat, [{ qty: m.qty, fatPct: m.pfat }]);
  return (
    <>
      <Sel l={bT('milk')} v={milk} set={setMilk} opts={[['buffalo', bT('milk.buffalo')], ['cow', bT('milk.cow')]]} />
      <div className={surface.tableWrap}>
        <table className={surface.table} data-dairy="starters">
          <thead><tr><th>{bT('product')}</th><th className={surface.numeric}>{bT('milkPerUnit')}</th><th className={surface.numeric}>{bT('gstToday')}</th><th /></tr></thead>
          <tbody>{DAIRY_STARTERS.map((s) => (
            <tr key={s.key}>
              <td>{s.name}{s.by ? ` + ${s.by.name}` : ''}</td><td className={surface.numeric}>{s.milkL} L</td><td className={surface.numeric}>{starterRate(s, todayInput())?.rate ?? '—'}%</td>
              <td><button type="button" className={sm} onClick={() => run(() => { addStarter(s.key, milk, todayInput()); return bT('starterAdded', { name: s.name }); })}>{bT('addStarter')}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className={controls.hint}>{bT('productsHint')} <Link to="/manufacturing">{bT('makeProducts')}</Link></p>
      <h3 className={surface.cardHeadIcon}>{bT('fatMemo')}</h3>
      <div className={controls.row} style={wrap}>
        <N l={bT('litres')} v={m.litres} set={(litres) => setM({ ...m, litres })} />
        <N l={bT('fat')} v={m.fat} set={(fat) => setM({ ...m, fat })} w={70} />
        <N l={bT('productQty')} v={m.qty} set={(qty) => setM({ ...m, qty })} />
        <N l={bT('productFat')} v={m.pfat} set={(pfat) => setM({ ...m, pfat })} w={90} />
        <span className={controls.hint} data-dairy="fat-memo">{bT('fatMemoText', { a: memo.fatIn, b: memo.fatOut, c: memo.loss, p: memo.lossPct })}</span>
      </div>
    </>
  );
}

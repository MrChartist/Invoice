import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { GatewayShell } from '../components/gateway/GatewayShell';
import { GatewayMenu } from '../components/gateway/GatewayMenu';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import { getTable } from '../lib/storage';
import { useT } from '../i18n';
import { isApplePlatform } from '../hooks/useHotkeys';
import { discoverT } from '../i18n/areas/discover-r6';

// The ledger-backed screens are their own chunks: opening the menu does not load the ledger engine.
const VoucherEntry = lazy(() => import('../components/gateway/VoucherEntry'));
const DisplayReport = lazy(() => import('../components/gateway/DisplayReport'));

/**
 * Gateway of Tally (Phase 7, Tally parity): /gateway (menu, `?m=<screen>` for sub-menus),
 * /gateway/voucher/:type (Contra / Payment / Receipt / Journal entry), /gateway/display (reports with
 * drill-down). Keyboard map: docs/features/gateway-keyboard.md.
 */
export function Gateway() {
  useT();
  // R6-B3: before the first voucher, one line on how the Gateway works and where the keys are (Ctrl+/).
  const first = getTable('vouchers').length === 0;
  return (
    <div className={surface.page}>
      {first && (
        <p className={controls.hint} role="note" data-gateway-hint>
          {discoverT('gatewayHint')}{' '}
          <button
            type="button"
            className={`${controls.btnGhost} ${controls.btnSm}`}
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', ctrlKey: !isApplePlatform(), metaKey: isApplePlatform() }))}
          >
            {discoverT('gatewayKeys')} (Ctrl+/)
          </button>
        </p>
      )}
      <GatewayShell>
        <Suspense fallback={null}>
          <Routes>
            <Route index element={<GatewayMenu />} />
            <Route path="voucher/:type" element={<VoucherEntry />} />
            <Route path="display" element={<DisplayReport />} />
            <Route path="*" element={<Navigate to="/gateway" replace />} />
          </Routes>
        </Suspense>
      </GatewayShell>
    </div>
  );
}

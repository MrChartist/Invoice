import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { GatewayShell } from '../components/gateway/GatewayShell';
import { GatewayMenu } from '../components/gateway/GatewayMenu';
import surface from '../styles/surface.module.css';

// The ledger-backed screens are their own chunks: opening the menu does not load the ledger engine.
const VoucherEntry = lazy(() => import('../components/gateway/VoucherEntry'));
const DisplayReport = lazy(() => import('../components/gateway/DisplayReport'));

/**
 * Gateway of Tally (Phase 7, Tally parity): /gateway (menu, `?m=<screen>` for sub-menus),
 * /gateway/voucher/:type (Contra / Payment / Receipt / Journal entry), /gateway/display (reports with
 * drill-down). Keyboard map: docs/features/gateway-keyboard.md.
 */
export function Gateway() {
  return (
    <div className={surface.page}>
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

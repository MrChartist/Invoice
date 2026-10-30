import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useMatch } from 'react-router-dom';
import { GatewayShell } from '../components/gateway/GatewayShell';
import { GatewayMenu } from '../components/gateway/GatewayMenu';
import { Page } from '../components/ui/Page';
import controls from '../styles/controls.module.css';
import { getTable } from '../lib/storage';
import { useT } from '../i18n';
import { isApplePlatform } from '../hooks/useHotkeys';
import { discoverT } from '../i18n/areas/discover-r6';
import { gwT } from '../i18n/areas/gateway';

const ScreenTip = lazy(() => import('../components/help/ScreenTip')); // R6-A6 one-time tip

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
  // PL: the menu's title is the page title (same size and place as every route); voucher entry and reports keep
  // their own headings, and a report display bleeds to the full width.
  const menu = !!useMatch('/gateway');
  const display = !!useMatch('/gateway/display');
  return (
    <Page
      title={menu ? gwT('title') : undefined}
      subtitle={menu ? gwT('subtitle') : undefined}
      tier={display ? 'bleed' : 'page'}
      notices={
        <>
          <Suspense fallback={null}><ScreenTip id="gateway" /></Suspense>
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
        </>
      }
    >
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
    </Page>
  );
}

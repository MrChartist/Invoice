/** Spacer row standing in for unmounted rows. Hidden from assistive tech; inline styles beat the card layout CSS. */
export function VirtualGap({ height, colSpan }: { height: number; colSpan: number }) {
  return (
    <tr aria-hidden="true" data-vgap="" style={{ height, padding: 0, border: 0, background: 'none' }}>
      <td colSpan={colSpan} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );
}

import { createPortal } from 'react-dom';
import type { TableRow } from '../../data/types';
import { qrSvg, tableQrUrl } from '../../lib/qr';
import { useManagerT } from './messages';

// Hidden on screen. When printing, every other child of <body> is hidden and the cards fill A4 pages.
const CSS = `
.qr-print-root{display:none}
@media print{
  @page{size:A4;margin:10mm}
  body>*:not(.qr-print-root){display:none!important}
  .qr-print-root{display:grid;grid-template-columns:1fr 1fr;gap:8mm;color:#000;background:#fff}
  .qr-card{break-inside:avoid;border:0.4mm solid #000;border-radius:4mm;padding:6mm;text-align:center}
  .qr-card svg{display:block;width:62mm;height:62mm;margin:3mm auto}
  .qr-shop{font-size:12pt;font-weight:600}
  .qr-label{font-size:30pt;font-weight:800;line-height:1.1}
  .qr-scan{font-size:16pt;font-weight:700}
}`;

/** The printable A4 sheet: one card per table (label, shop name, QR, "Scan to order"). */
export function QrPrint({ shopName, tables }: { shopName: string; tables: readonly TableRow[] }) {
  const t = useManagerT();
  return createPortal(
    <div className="qr-print-root" aria-hidden="true">
      <style>{CSS}</style>
      {tables.map((table) => (
        <div key={table.id} className="qr-card">
          <div className="qr-shop">{shopName}</div>
          <div className="qr-label">{table.label}</div>
          <div data-testid="qr-print-svg" dangerouslySetInnerHTML={{ __html: qrSvg(tableQrUrl(table.token)) }} />
          <div className="qr-scan">{t('scan_to_order')}</div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

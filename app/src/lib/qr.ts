import QRCode from 'qrcode';
import { SITE_BASE_URL } from '../config';

/** The address a table's printed QR code opens. */
export const tableQrUrl = (token: string): string => `${SITE_BASE_URL}#/t/${token}`;

/** Inline SVG (black modules on white, with a quiet zone). Built from booleans only, so it is safe to inject. */
export function qrSvg(text: string): string {
  const modules = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
  const size = modules.size;
  const margin = 2;
  let path = '';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules.get(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
  const n = size + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

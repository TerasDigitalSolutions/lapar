import { useEffect } from 'react';
import type { ShopTheme } from '../data/types';

/** Three swatches per theme for the owner picker. */
export const THEMES: { id: ShopTheme; swatch: [string, string, string] }[] = [
  { id: 'kopitiam', swatch: ['#FFF8EE', '#C2410C', '#3B2414'] },
  { id: 'pandan', swatch: ['#F2FAF4', '#166534', '#1F2D22'] },
  { id: 'teh-tarik', swatch: ['#FAF5EF', '#78350F', '#B45309'] },
  { id: 'malam', swatch: ['#18181B', '#F59E0B', '#FAFAFA'] },
];

// Nested screens (the demo shell around a view) each ask for a theme; the newest live request wins,
// and unmounting one only drops its own request.
const requests: { theme: ShopTheme }[] = [];
const apply = () => {
  const top = requests.at(-1);
  if (top) document.documentElement.dataset.theme = top.theme;
  else delete document.documentElement.dataset.theme;
};

/** Sets data-theme on <html> while mounted; no theme (null/undefined) leaves the default. */
export function useShopTheme(theme: ShopTheme | null | undefined) {
  useEffect(() => {
    if (!theme) return;
    const req = { theme };
    requests.push(req);
    apply();
    return () => {
      requests.splice(requests.indexOf(req), 1);
      apply();
    };
  }, [theme]);
}

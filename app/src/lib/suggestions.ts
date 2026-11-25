import type { MenuCategory, MenuItem, Uuid } from '../data/types';

/** Up to 3 suggestions for `item`, in candidate order, skipping unusable ones. Callers track "once per dish per visit". */
export function pickSuggestions(args: {
  item: MenuItem;
  itemsById: ReadonlyMap<Uuid, MenuItem>;
  categoriesById: ReadonlyMap<Uuid, MenuCategory>;
  cartItemIds: ReadonlySet<Uuid> | readonly Uuid[];
}): MenuItem[] {
  const inCart = new Set(args.cartItemIds);
  const parts = new Set(args.item.combo?.components.map((c) => c.itemId));
  const out: MenuItem[] = [];
  for (const { itemId } of args.item.suggestions) {
    const s = args.itemsById.get(itemId);
    if (!s || s.id === args.item.id || s.soldOut || inCart.has(s.id) || parts.has(s.id)) continue;
    if (args.categoriesById.get(s.categoryId)?.availableNow === false) continue;
    if (out.some((o) => o.id === s.id)) continue;
    out.push(s);
    if (out.length === 3) break;
  }
  return out;
}

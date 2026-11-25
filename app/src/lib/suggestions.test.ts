import { expect, test } from 'vitest';
import type { MenuCategory, MenuItem } from '../data/types';
import { pickSuggestions } from './suggestions';

const item = (id: string, over: Partial<MenuItem> = {}): MenuItem => ({
  id, categoryId: 'c1', name: id, description: '', translations: {}, priceSen: 100, effectivePriceSen: 100,
  promo: null, photoUrl: null, soldOut: false, sort: 0, groups: [], suggestions: [], combo: null, ...over,
});
const cat = (id: string, availableNow = true): MenuCategory => ({ id, name: id, translations: {}, sort: 0, window: null, availableNow });

test('skips missing, sold out, closed category, in cart and self; caps at 3', () => {
  const main = item('main', { suggestions: ['main', 'gone', 'sold', 'closed', 'cart', 'a', 'b', 'c', 'd'].map((itemId) => ({ itemId, source: 'manual' as const })) });
  const all = [main, item('sold', { soldOut: true }), item('closed', { categoryId: 'c2' }), item('cart'), item('a'), item('b'), item('c'), item('d')];
  const res = pickSuggestions({
    item: main,
    itemsById: new Map(all.map((i) => [i.id, i])),
    categoriesById: new Map([cat('c1'), cat('c2', false)].map((c) => [c.id, c])),
    cartItemIds: ['cart'],
  });
  expect(res.map((i) => i.id)).toEqual(['a', 'b', 'c']);
});

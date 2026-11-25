import { describe, expect, it } from 'vitest';
import type { PromoRow } from '../data/types';
import { bestPromo, promoEndsAt, promoPrice } from './pricing';

const promo = (p: Partial<PromoRow>): PromoRow => ({
  id: 'p1', shopId: 's', name: 'Happy', translations: {}, discountType: 'percent', discountValue: 20,
  days: [1, 2, 3, 4, 5, 6, 7], startTime: '14:00', endTime: '17:00', active: true, itemIds: ['i1'], ...p,
});
const at = (hhmm: string) => new Date(`2026-11-25T${hhmm}:00+08:00`); // a Wednesday

describe('promoPrice', () => {
  it('rounds percent half up', () => {
    expect(promoPrice(220, { discountType: 'percent', discountValue: 20 })).toBe(176);
    expect(promoPrice(225, { discountType: 'percent', discountValue: 15 })).toBe(191);
    expect(promoPrice(220, { discountType: 'percent', discountValue: 100 })).toBe(0);
  });
  it('amount never goes below zero', () => {
    expect(promoPrice(220, { discountType: 'amount', discountValue: 50 })).toBe(170);
    expect(promoPrice(220, { discountType: 'amount', discountValue: 500 })).toBe(0);
  });
});

describe('bestPromo', () => {
  const item = { id: 'i1', priceSen: 220 };
  it('picks the lowest price among running promos', () => {
    const a = promo({ id: 'a' });
    const b = promo({ id: 'b', discountType: 'amount', discountValue: 100 });
    expect(bestPromo(item, [a, b], at('15:00'))).toEqual({ promo: b, priceSen: 120 });
  });
  it('ignores inactive, other-item, off-window and off-day promos', () => {
    expect(bestPromo(item, [promo({ active: false })], at('15:00'))).toBeNull();
    expect(bestPromo(item, [promo({ itemIds: ['i2'] })], at('15:00'))).toBeNull();
    expect(bestPromo(item, [promo({})], at('17:00'))).toBeNull(); // end is exclusive
    expect(bestPromo(item, [promo({ days: [1] })], at('15:00'))).toBeNull();
  });
});

describe('promoEndsAt', () => {
  it('is today at the end time, or tomorrow when the window wraps', () => {
    expect(promoEndsAt(promo({}), at('15:00'))).toBe('2026-11-25T09:00:00.000Z');
    expect(promoEndsAt(promo({ startTime: '22:00', endTime: '02:00' }), at('23:00'))).toBe('2026-11-25T18:00:00.000Z');
  });
});

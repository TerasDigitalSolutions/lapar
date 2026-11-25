/** Promo pricing (mirror of the SQL in DATA-MODEL 6.1 `get_menu` / `place_order` step 6). */
import type { IsoDateTime, PromoRow, Sen, Uuid } from '../data/types';
import { addDays, inWindow, mytParts } from './time';

type PromoValue = Pick<PromoRow, 'discountType' | 'discountValue'>;
type PromoRule = PromoValue & Pick<PromoRow, 'active' | 'itemIds' | 'days' | 'startTime' | 'endTime'>;

/** percent: (list * (100 - v) + 50) / 100 in integer maths; amount: list - v, never below 0. */
export function promoPrice(listSen: Sen, promo: PromoValue): Sen {
  return promo.discountType === 'percent'
    ? Math.floor((listSen * (100 - promo.discountValue) + 50) / 100)
    : Math.max(listSen - promo.discountValue, 0);
}

/** The active promo listing the item and running at `at` with the lowest price (first one on a tie). */
export function bestPromo<P extends PromoRule>(
  item: { id: Uuid; priceSen: Sen },
  promos: readonly P[],
  at: Date,
): { promo: P; priceSen: Sen } | null {
  let best: { promo: P; priceSen: Sen } | null = null;
  for (const promo of promos) {
    if (!promo.active || !promo.itemIds.includes(item.id)) continue;
    if (!inWindow({ from: promo.startTime, to: promo.endTime, days: promo.days }, at)) continue;
    const priceSen = promoPrice(item.priceSen, promo);
    if (!best || priceSen < best.priceSen) best = { promo, priceSen };
  }
  return best;
}

/** Today's (MYT) end time of the promo window; the next day when it wraps midnight and `at` is not yet past midnight. */
export function promoEndsAt(promo: Pick<PromoRow, 'startTime' | 'endTime'>, at: Date): IsoDateTime {
  const { date: today, hour, minute } = mytParts(at);
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const day = promo.endTime < promo.startTime && time >= promo.endTime ? addDays(today, 1) : today;
  return new Date(`${day}T${promo.endTime}:00+08:00`).toISOString();
}

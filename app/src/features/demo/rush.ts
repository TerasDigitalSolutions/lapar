import type { LaparDemoData, ServiceReason } from '../../data/types';
import { mulberry32 } from '../../lib/rng';

export const RUSH_MS = 120_000;
const ORDERS = 12;
const CALLS = 5;
const REASONS: ServiceReason[] = ['water', 'bill', 'water', 'other', 'bill'];

async function placeRandom(demo: LaparDemoData, token: string, size: number, pick: number) {
  const menu = await demo.customer.getMenu(token);
  const open = new Set(menu.categories.filter((c) => c.availableNow).map((c) => c.id));
  const items = menu.items.filter((i) => !i.soldOut && open.has(i.categoryId) && i.groups.every((g) => g.minSelect === 0));
  if (items.length === 0) return;
  const lines = Array.from({ length: size }, (_, k) => ({ itemId: items[(pick + k * 7) % items.length]!.id, qty: 1, optionIds: [] }));
  await demo.customer.placeOrder(token, { lines });
}

/**
 * Spreads 12 orders and 5 calls from tables other than `skipToken` over two minutes, through the customer API.
 * Returns a stop function. Failures (rate limit, sold out) are ignored: it is background noise.
 */
export function startRush(demo: LaparDemoData, skipToken: string, onDone: () => void, seed = 42): () => void {
  const rnd = mulberry32(seed);
  const tokens = demo.tables.filter((t) => t.kind === 'table' && t.token !== skipToken).map((t) => t.token);
  const total = ORDERS + CALLS;
  let orders = 0;
  let calls = 0;
  const timers = Array.from({ length: total }, (_, i) => {
    const isCall = i % 3 === 2 && calls < CALLS;
    const n = isCall ? calls++ : orders++;
    const token = tokens[(isCall ? n + 4 : n) % tokens.length]!;
    const at = ((i + rnd() * 0.8) / total) * (RUSH_MS - 4_000) + 1_000;
    const pick = Math.floor(rnd() * 1000);
    return setTimeout(() => {
      const run = isCall ? demo.customer.callServer(token, REASONS[n % REASONS.length]!) : placeRandom(demo, token, 1 + (pick % 3), pick);
      run.catch(() => {});
    }, at);
  });
  const end = setTimeout(onDone, RUSH_MS);
  return () => (timers.forEach(clearTimeout), clearTimeout(end));
}

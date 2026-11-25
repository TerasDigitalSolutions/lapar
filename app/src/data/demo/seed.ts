/** Kopitiam Teras, from DATA-MODEL section 11 (readable string ids). Pro parts are seeded too and gated by the plan. */
import type {
  CategoryRow,
  ComboComponentRow,
  ItemRow,
  ModifierGroupRow,
  ModifierOptionRow,
  PairingRow,
  TableRow,
  Translations,
} from '../types';
import { STATE_VERSION, type DemoState } from './store';

export const SHOP_ID = 'shop-kopitiam-teras';
export const PICKUP_BOARD_TOKEN = 'demo-pickup';
export const KITCHEN_ID = 'station-kitchen';
export const DRINKS_STATION_ID = 'station-drinks';
export const COUNTER_ID = 'table-counter';
export const COUNTER_TOKEN = 'demo-counter';
export const SEED_STAFF = [
  { id: 'staff-aminah', name: 'Aminah', pin: '1234' },
  { id: 'staff-ravi', name: 'Ravi', pin: '5678' },
] as const;

type Cat = { slug: string; name: string; ms: string; zh: string; window?: { from: string; to: string } };
const CATEGORIES: Cat[] = [
  { slug: 'sets', name: 'Sets', ms: 'Set', zh: '套餐' },
  { slug: 'drinks', name: 'Drinks', ms: 'Minuman', zh: '饮料' },
  { slug: 'breakfast', name: 'Breakfast', ms: 'Sarapan', zh: '早餐', window: { from: '06:00', to: '11:30' } },
  { slug: 'rice', name: 'Rice', ms: 'Nasi', zh: '饭类' },
  { slug: 'noodles', name: 'Noodles', ms: 'Mi', zh: '面类', window: { from: '11:00', to: '21:00' } },
  { slug: 'sides', name: 'Sides', ms: 'Sampingan', zh: '小食' },
];

// [category, slug, name, price sen, Malay name (when different), Chinese name]
const ITEMS: [string, string, string, number, string | null, string][] = [
  ['sets', 'set-a', 'Set A', 700, null, '套餐A'],
  ['sets', 'set-b', 'Set B', 320, null, '套餐B'],
  ['drinks', 'teh-tarik', 'Teh tarik', 220, null, '拉茶'],
  ['drinks', 'kopi', 'Kopi', 200, null, '咖啡'],
  ['drinks', 'kopi-o', 'Kopi O', 180, null, '咖啡乌'],
  ['drinks', 'milo-ais', 'Milo ais', 320, null, '冰美禄'],
  ['drinks', 'teh-o-ais-limau', 'Teh O ais limau', 280, null, '冰柠檬茶'],
  ['drinks', 'sirap-bandung', 'Sirap bandung', 280, null, '玫瑰露奶'],
  ['breakfast', 'roti-canai', 'Roti canai', 150, null, '印度煎饼'],
  ['breakfast', 'roti-telur', 'Roti telur', 250, null, '鸡蛋煎饼'],
  ['breakfast', 'kaya-toast', 'Kaya toast', 300, 'Roti bakar kaya', '咖椰吐司'],
  ['breakfast', 'half-boiled-eggs', 'Half-boiled eggs', 300, 'Telur separuh masak', '半生熟蛋'],
  ['rice', 'nasi-lemak', 'Nasi lemak', 550, null, '椰浆饭'],
  ['rice', 'nasi-lemak-ayam', 'Nasi lemak ayam goreng', 1050, null, '炸鸡椰浆饭'],
  ['rice', 'nasi-goreng-kampung', 'Nasi goreng kampung', 800, null, '甘榜炒饭'],
  ['rice', 'nasi-ayam', 'Nasi ayam', 850, null, '鸡饭'],
  ['noodles', 'mee-goreng-mamak', 'Mee goreng mamak', 750, null, '嘛嘛炒面'],
  ['noodles', 'char-kuey-teow', 'Char kuey teow', 900, null, '炒粿条'],
  ['noodles', 'mee-rebus', 'Mee rebus', 700, null, '卤面'],
  ['sides', 'telur-mata', 'Telur mata', 120, null, '荷包蛋'],
  ['sides', 'ayam-goreng', 'Ayam goreng', 500, null, '炸鸡'],
  ['sides', 'extra-kari', 'Extra kari', 100, 'Kari tambahan', '加咖喱'],
];

// item -> groups [slug, name, min, max, options [slug, name, +sen][]]
type Group = [string, string, number, number, [string, string, number][]];
const TEMP: Group = ['temp', 'Panas / Ais', 1, 1, [['panas', 'Panas', 0], ['ais', 'Ais', 30]]];
const SWEET: Group = ['sweet', 'Manis', 0, 1, [['kurang-manis', 'Kurang manis', 0], ['kosong', 'Kosong', 0]]];
const PACK: Group = ['pack', 'Bungkus', 0, 1, [['bungkus', 'Bungkus', 20]]];
const SPICE: Group = ['spice', 'Pedas', 1, 1, [['biasa', 'Biasa', 0], ['pedas', 'Pedas', 0], ['tak-pedas', 'Tak pedas', 0]]];
const GROUPS: Record<string, Group[]> = {
  'teh-tarik': [TEMP, SWEET, PACK],
  kopi: [TEMP, SWEET, PACK],
  'kopi-o': [TEMP, SWEET, PACK],
  'milo-ais': [SWEET],
  'roti-canai': [
    ['kuah', 'Kuah', 1, 1, [['dhal', 'Dhal', 0], ['kari', 'Kari', 0], ['campur', 'Campur', 0]]],
    ['add', 'Tambah', 0, 2, [['telur', 'Telur', 100], ['bawang', 'Bawang', 50]]],
  ],
  'nasi-lemak': [['add', 'Tambah', 0, 3, [['telur-mata', 'Telur mata', 120], ['ayam-goreng', 'Ayam goreng', 500], ['sambal', 'Sambal extra', 50]]]],
  'mee-goreng-mamak': [SPICE, ['add', 'Tambah', 0, 1, [['telur', 'Telur', 100]]]],
  'char-kuey-teow': [SPICE],
};

const PAIRINGS: Record<string, string[]> = {
  'nasi-lemak': ['teh-tarik', 'telur-mata', 'ayam-goreng'],
  'roti-canai': ['teh-tarik', 'telur-mata', 'extra-kari'],
  'kaya-toast': ['half-boiled-eggs', 'kopi'],
};

const DRINK_ITEMS = new Set(['teh-tarik', 'kopi', 'kopi-o', 'milo-ais', 'teh-o-ais-limau', 'sirap-bandung']);

export function seedState(nowIso: string): DemoState {
  const categories: CategoryRow[] = CATEGORIES.map((c, i) => ({
    id: `cat-${c.slug}`,
    shopId: SHOP_ID,
    name: c.name,
    translations: { ms: { name: c.ms }, zh: { name: c.zh } },
    sort: i,
    window: c.window ? { from: c.window.from, to: c.window.to, days: null } : null,
  }));

  const sortInCat = new Map<string, number>();
  const items: ItemRow[] = ITEMS.map(([cat, slug, name, priceSen, ms, zh]) => {
    const sort = sortInCat.get(cat) ?? 0;
    sortInCat.set(cat, sort + 1);
    const translations: Translations = { ms: { name: ms ?? name }, zh: { name: zh } };
    return {
      id: `item-${slug}`,
      shopId: SHOP_ID,
      categoryId: `cat-${cat}`,
      stationId: DRINK_ITEMS.has(slug) ? DRINKS_STATION_ID : KITCHEN_ID,
      name,
      description: '',
      translations,
      priceSen,
      photoUrl: null,
      photoState: 'none',
      active: true,
      soldOut: false,
      isCombo: cat === 'sets',
      sort,
    };
  });

  const groups: ModifierGroupRow[] = [];
  const options: ModifierOptionRow[] = [];
  for (const [item, list] of Object.entries(GROUPS)) {
    list.forEach(([gslug, gname, min, max, opts], gi) => {
      const groupId = `group-${item}-${gslug}`;
      groups.push({ id: groupId, shopId: SHOP_ID, itemId: `item-${item}`, name: gname, translations: {}, minSelect: min, maxSelect: max, sort: gi });
      opts.forEach(([oslug, oname, delta], oi) =>
        options.push({ id: `opt-${item}-${oslug}`, shopId: SHOP_ID, groupId, name: oname, translations: {}, priceDeltaSen: delta, sort: oi }),
      );
    });
  }

  const pairings: PairingRow[] = Object.entries(PAIRINGS).flatMap(([src, list]) =>
    list.map((s, i) => ({ sourceItemId: `item-${src}`, suggestedItemId: `item-${s}`, position: (i + 1) as 1 | 2 | 3 })),
  );

  const comboComponents: ComboComponentRow[] = [
    { comboItemId: 'item-set-a', itemId: 'item-nasi-lemak', qty: 1, sort: 0 },
    { comboItemId: 'item-set-a', itemId: 'item-teh-tarik', qty: 1, sort: 1 },
    { comboItemId: 'item-set-b', itemId: 'item-roti-canai', qty: 1, sort: 0 },
    { comboItemId: 'item-set-b', itemId: 'item-kopi', qty: 1, sort: 1 },
  ];

  const tables: TableRow[] = Array.from({ length: 10 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return { id: `table-${n}`, shopId: SHOP_ID, label: `Table ${i + 1}`, kind: 'table', token: `demo-table-${n}`, active: true, sort: i };
  });
  tables.push({ id: COUNTER_ID, shopId: SHOP_ID, label: 'Counter', kind: 'counter', token: COUNTER_TOKEN, active: true, sort: 10 });

  return {
    version: STATE_VERSION,
    plan: 'basic',
    clock: 'real',
    seq: 0,
    shop: {
      id: SHOP_ID,
      name: 'Kopitiam Teras',
      slug: 'kopitiam-teras',
      logoUrl: null,
      planId: 'basic',
      approvalMode: 'first_order',
      nudgeCategoryId: 'cat-drinks',
      active: true,
      pickupBoardToken: PICKUP_BOARD_TOKEN,
      createdAt: nowIso,
    },
    stations: [
      { id: KITCHEN_ID, shopId: SHOP_ID, name: 'Kitchen', sort: 0, active: true },
      { id: DRINKS_STATION_ID, shopId: SHOP_ID, name: 'Drinks', sort: 1, active: true },
    ],
    categories,
    items,
    groups,
    options,
    pairings,
    autoPairings: [],
    comboComponents,
    promos: [
      {
        id: 'promo-happy-hour',
        shopId: SHOP_ID,
        name: 'Happy hour',
        translations: { ms: { name: 'Waktu gembira' }, zh: { name: '欢乐时光' } },
        discountType: 'percent',
        discountValue: 20,
        days: [1, 2, 3, 4, 5, 6, 7],
        startTime: '14:00',
        endTime: '17:00',
        active: true,
        itemIds: ['item-teh-tarik', 'item-kopi', 'item-kopi-o', 'item-milo-ais'],
      },
    ],
    boardColumns: [],
    tables,
    staff: SEED_STAFF.map((s) => ({ id: s.id, shopId: SHOP_ID, name: s.name, active: true, createdAt: nowIso })),
    staffPins: SEED_STAFF.map((s) => ({ staffId: s.id, pin: s.pin })),
    actorStaffId: SEED_STAFF[0].id,
    pinAttempts: { failures: 0, lockedUntil: null },
    pickupCounters: [],
    tabs: [],
    orders: [],
    orderItems: [],
    requests: [],
    payments: [],
  };
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../../data/context';
import { toLaparError, usePolling } from '../../data/hooks';
import type { CustomerTabDTO, LaparError, MenuDTO, MenuItem, Uuid } from '../../data/types';
import { formatRM } from '../../lib/money';
import { pickSuggestions } from '../../lib/suggestions';
import { Button, EmptyState, ErrorState, Loading, PhotoTile, TabBar } from '../../ui';
import { addLine, loadCart, loadTabId, markSeen, saveCart, saveTabId, seenSet, tr, unitSen, type CartLine } from './cart';
import { useT } from './messages';
import { CallPanel, StatusPanel } from './panels';
import { CartSheet, ItemPrice, ItemSheet, PickSheet } from './sheets';

type Sheet = { k: 'item'; item: MenuItem; from: Uuid | null; ret: 'suggest' | 'cart' } | { k: 'suggest'; source: MenuItem; items: MenuItem[] } | { k: 'nudge'; items: MenuItem[] } | { k: 'cart' } | null;
type Panel = 'menu' | 'orders' | 'call';

export function CustomerView({ tableToken }: { tableToken: string }) {
  const data = useData();
  const t = useT();
  const [menu, setMenu] = useState<MenuDTO | null>(null);
  const [error, setError] = useState<LaparError | null>(null);
  const [panel, setPanel] = useState<Panel>('menu');
  const [cart, setCartState] = useState<CartLine[]>(() => loadCart(tableToken));
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sending, setSending] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [tab, setTab] = useState<CustomerTabDTO | null>(null);
  const [tabError, setTabError] = useState<unknown>(null);

  const setCart = useCallback(
    (f: (c: CartLine[]) => CartLine[]) =>
      setCartState((c) => {
        const next = f(c);
        saveCart(tableToken, next);
        return next;
      }),
    [tableToken],
  );

  const loadMenu = useCallback(
    (): Promise<MenuDTO | null> =>
      data.customer.getMenu(tableToken).then(
        (m) => (setMenu(m), setError(null), m),
        (e: unknown) => (setError(toLaparError(e)), null),
      ),
    [data, tableToken],
  );

  const loadTab = useCallback(
    () =>
      data.customer.getTab(tableToken, loadTabId(tableToken)).then(
        (x) => (setTab(x), setTabError(null)),
        (e: unknown) => setTabError(e),
      ),
    [data, tableToken],
  );

  useEffect(() => {
    void loadMenu();
    void loadTab();
  }, [loadMenu, loadTab]);
  usePolling(loadTab, 10_000);

  const itemsById = useMemo(() => new Map((menu?.items ?? []).map((i) => [i.id, i])), [menu]);
  const categoriesById = useMemo(() => new Map((menu?.categories ?? []).map((c) => [c.id, c])), [menu]);
  // Lines whose dish left the menu (edited or sold out) are dropped from view and from the order.
  const validCart = useMemo(() => cart.filter((l) => itemsById.has(l.itemId)), [cart, itemsById]);

  if (!menu) {
    if (!error) return <Loading />;
    if (error.code === 'not_found') return <EmptyState title={t('invalid_qr')}>{t('invalid_qr_body')}</EmptyState>;
    return <ErrorState error={error} onRetry={() => void loadMenu()} />;
  }
  if (!menu.shop.active) return <EmptyState title={t('not_taking_orders')}>{t('not_taking_orders_body')}</EmptyState>;

  const cartCount = validCart.reduce((n, l) => n + l.qty, 0);
  const cartTotal = validCart.reduce((s, l) => s + l.qty * unitSen(itemsById.get(l.itemId)!, l.optionIds), 0);
  const sections = menu.categories.map((c) => ({ c, items: menu.items.filter((i) => i.categoryId === c.id) })).filter((s) => s.items.length > 0);
  const orderable = (i: MenuItem) => !i.soldOut && categoriesById.get(i.categoryId)?.availableNow !== false;

  const open = (item: MenuItem, from: Uuid | null = null, ret: 'suggest' | 'cart' = 'suggest') => setSheet({ k: 'item', item, from, ret });

  function afterAdd(line: CartLine, ret: 'suggest' | 'cart') {
    const item = itemsById.get(line.itemId)!;
    const nextCart = addLine(validCart, line);
    setCart(() => nextCart);
    if (ret === 'cart') return setSheet({ k: 'cart' });
    // Suggestions: once per dish per visit, never for dishes already in the cart or sold out.
    const items = seenSet(tableToken, 'sugg').includes(item.id)
      ? []
      : pickSuggestions({ item, itemsById, categoriesById, cartItemIds: nextCart.map((l) => l.itemId) });
    if (items.length === 0) return setSheet(null);
    markSeen(tableToken, 'sugg', item.id);
    setSheet({ k: 'suggest', source: item, items });
  }

  /** One tap adds a suggestion; dishes with required options open their sheet instead. */
  function pickSuggested(source: MenuItem, item: MenuItem, shown: MenuItem[]) {
    if (item.groups.some((g) => g.minSelect > 0)) return open(item, source.id, 'cart');
    setCart((c) => addLine(c, { itemId: item.id, qty: 1, optionIds: [], note: '', from: source.id }));
    const rest = shown.filter((i) => i.id !== item.id);
    setSheet(rest.length ? { k: 'suggest', source, items: rest } : null);
  }

  async function place(skipNudge = false) {
    const nudgeCat = menu!.features.checkout_nudge ? menu!.shop.nudgeCategoryId : null;
    if (!skipNudge && nudgeCat && !seenSet(tableToken, 'nudge').length && !validCart.some((l) => itemsById.get(l.itemId)?.categoryId === nudgeCat)) {
      const items = menu!.items.filter((i) => i.categoryId === nudgeCat && orderable(i));
      if (items.length) {
        markSeen(tableToken, 'nudge', nudgeCat);
        return setSheet({ k: 'nudge', items });
      }
    }
    setSending(true);
    setPlaceError(null);
    try {
      const r = await data.customer.placeOrder(tableToken, {
        lines: validCart.map((l) => ({ itemId: l.itemId, qty: l.qty, optionIds: l.optionIds, note: l.note || null, suggestedFromItemId: l.from })),
      });
      saveTabId(tableToken, r.tabId);
      setCart(() => []);
      setSheet(null);
      setSent(true);
      setPanel('orders');
      void loadTab();
    } catch (e) {
      const err = toLaparError(e);
      if (err.code === 'sold_out' || err.code === 'item_unavailable') {
        const fresh = await loadMenu();
        const ok = new Set((fresh?.items ?? []).filter((i) => !i.soldOut).map((i) => i.id));
        const gone = validCart.filter((l) => !ok.has(l.itemId) || l.itemId === err.detail);
        setCart((c) => c.filter((l) => !gone.some((g) => g.itemId === l.itemId)));
        const names = [...new Set(gone.map((l) => itemsById.get(l.itemId)?.name ?? ''))].filter(Boolean).join(', ');
        setPlaceError(names ? t('err_gone', { names }) : t('err_gone_generic'));
      } else if (err.code === 'shop_inactive') {
        void loadMenu();
      } else {
        setPlaceError(err.code === 'rate_limited' ? t('err_rate_limited') : err.code === 'network' ? t('err_network') : t('err_generic'));
      }
    } finally {
      setSending(false);
    }
  }

  const tabs = [
    { id: 'menu' as const, label: t('tab_menu') },
    { id: 'orders' as const, label: t('tab_orders') },
    ...(menu.features.call_server ? [{ id: 'call' as const, label: t('tab_call') }] : []),
  ];

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-stone-50 pb-28">
      <header className="flex items-center gap-3 bg-white p-4">
        {menu.shop.logoUrl && <PhotoTile url={menu.shop.logoUrl} name={menu.shop.name} className="size-12" />}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{menu.shop.name}</h1>
          <p className="text-stone-700">{menu.table.label}</p>
        </div>
      </header>
      <TabBar tabs={tabs} value={panel} onChange={setPanel} />

      {panel === 'menu' && (
        <div role="tabpanel" id="panel-menu" aria-labelledby="tab-menu">
          {sections.length === 0 ? (
            <EmptyState title={t('empty_menu')} />
          ) : (
            <>
              <nav aria-label={t('categories')} className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-stone-200 bg-white px-4 py-2">
                {sections.map(({ c }) => (
                  <button
                    key={c.id}
                    type="button"
                    className="min-h-12 shrink-0 rounded-full bg-stone-100 px-5 font-semibold text-stone-900 active:bg-orange-100"
                    onClick={() => document.getElementById(`cat-${c.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}
                  >
                    {tr(c.name, c.translations)}
                  </button>
                ))}
              </nav>
              {sections.map(({ c, items }) => (
                <section key={c.id} id={`cat-${c.id}`} aria-label={tr(c.name, c.translations)} className="scroll-mt-16 px-4 pt-4">
                  <h2 className="mb-2 text-lg font-bold">{tr(c.name, c.translations)}</h2>
                  <ul className="flex flex-col gap-2">
                    {items.map((i) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          disabled={!orderable(i)}
                          onClick={() => open(i)}
                          className={`flex min-h-24 w-full items-center gap-3 rounded-xl border border-stone-200 bg-white p-2 text-left ${orderable(i) ? 'active:bg-orange-50' : 'opacity-50'}`}
                        >
                          <PhotoTile url={i.photoUrl} name={i.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{tr(i.name, i.translations)}</span>
                            {!orderable(i) && <span className="block text-sm font-medium text-stone-700">{i.soldOut ? t('sold_out') : t('not_now')}</span>}
                          </span>
                          <ItemPrice item={i} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      )}
      {panel === 'orders' && (
        <div role="tabpanel" id="panel-orders" aria-labelledby="tab-orders">
          <StatusPanel tab={tab} error={tabError} onRetry={() => void loadTab()} sent={sent} />
        </div>
      )}
      {panel === 'call' && (
        <div role="tabpanel" id="panel-call" aria-labelledby="tab-call">
          <CallPanel token={tableToken} tab={tab} onCalled={() => void loadTab()} />
        </div>
      )}

      {panel === 'menu' && cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button block className="min-h-14 justify-between text-lg shadow-lg" onClick={() => (setPlaceError(null), setSheet({ k: 'cart' }))}>
            <span>
              {t('view_order')} · {cartCount}
            </span>
            <span>{formatRM(cartTotal)}</span>
          </Button>
        </div>
      )}

      {sheet?.k === 'item' && (
        <ItemSheet key={sheet.item.id} item={sheet.item} from={sheet.from} onAdd={(l) => afterAdd(l, sheet.ret)} onClose={() => setSheet(sheet.ret === 'cart' ? { k: 'cart' } : null)} />
      )}
      {sheet?.k === 'suggest' && (
        <PickSheet
          title={t('suggest_title')}
          items={sheet.items}
          autoIds={new Set(sheet.source.suggestions.filter((s) => s.source === 'auto').map((s) => s.itemId))}
          skipLabel={t('no_thanks')}
          onPick={(i) => pickSuggested(sheet.source, i, sheet.items)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.k === 'nudge' && (
        <PickSheet
          title={t('nudge_title')}
          body={t('nudge_body')}
          items={sheet.items}
          skipLabel={t('nudge_skip')}
          onPick={(i) => (i.groups.some((g) => g.minSelect > 0) ? open(i, null, 'cart') : (setCart((c) => addLine(c, { itemId: i.id, qty: 1, optionIds: [], note: '', from: null })), setSheet({ k: 'cart' })))}
          onSkip={() => (setSheet({ k: 'cart' }), void place(true))}
          onClose={() => setSheet({ k: 'cart' })}
        />
      )}
      {sheet?.k === 'cart' && (
        <CartSheet
          menu={menu}
          cart={validCart}
          sending={sending}
          error={placeError}
          onQty={(i, qty) => setCart(() => validCart.map((l, j) => (j === i ? { ...l, qty } : l)))}
          onRemove={(i) => setCart(() => validCart.filter((_, j) => j !== i))}
          onPlace={() => void place()}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

import { useData } from '../../data/context';
import { useLiveQuery } from '../../data/hooks';
import { EmptyState, ErrorState, Loading, Toggle, useToast } from '../../ui';
import { useStaffT } from './messages';

export function SoldOutTab({ shopId }: { shopId: string }) {
  const t = useStaffT();
  const api = useData().staff;
  const toast = useToast();
  // No realtime table for items: poll while visible so two phones stay in step.
  const items = useLiveQuery(() => api.listSoldOutItems(shopId), { shopId, tables: [], pollMs: 30_000 });

  if (!items.data) return items.error ? <ErrorState error={items.error} onRetry={items.reload} /> : <Loading />;
  if (items.data.length === 0) return <EmptyState title={t('soldout_empty')} />;

  const groups = new Map<string, typeof items.data>();
  for (const i of items.data) groups.set(i.categoryName, [...(groups.get(i.categoryName) ?? []), i]);

  const toggle = (id: string, soldOut: boolean) =>
    api.setSoldOut(id, soldOut).then(items.reload, () => {
      toast(t('action_failed'), 'error');
      items.reload();
    });

  return (
    <div className="flex flex-col gap-5 p-4">
      <p className="text-stone-600">{t('soldout_hint')}</p>
      {[...groups].map(([category, list]) => (
        <section key={category} aria-label={category}>
          <h2 className="mb-1 text-lg font-bold text-stone-900">{category}</h2>
          <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-3">
            {list.map((i) => (
              <li key={i.id}>
                <Toggle label={i.name} checked={i.soldOut} onChange={(v) => void toggle(i.id, v)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

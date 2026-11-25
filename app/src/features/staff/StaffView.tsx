import { useState } from 'react';
import { useData } from '../../data/context';
import { useLiveQuery } from '../../data/hooks';
import { readJson, writeJson } from '../../lib/storage';
import { Banner, Button, ErrorState, Loading, TabBar, type TabItem } from '../../ui';
import { KitchenView } from '../kitchen/KitchenView';
import { OrdersTab } from './OrdersTab';
import { SoldOutTab } from './SoldOutTab';
import { TablesTab } from './TablesTab';
import { useStaffAlerts } from './useStaffAlerts';
import { useStaffT } from './messages';

type TabId = 'orders' | 'kitchen' | 'tables' | 'soldout';
const TAB_IDS: readonly TabId[] = ['orders', 'kitchen', 'tables', 'soldout'];
const TAB_KEY = 'lapar.staff.tab';

export function StaffView({ shopId }: { shopId: string }) {
  const t = useStaffT();
  const api = useData().staff;
  const [tab, setTab] = useState<TabId>(() => {
    const saved = readJson<string>(TAB_KEY, 'orders');
    return TAB_IDS.find((id) => id === saved) ?? 'orders';
  });
  // Loaded here, not in the Orders tab, so alerts and the badge work on every tab.
  const pending = useLiveQuery(() => api.listPendingOrders(shopId), { shopId, tables: ['orders', 'order_items'], pollMs: 30_000 });
  const calls = useLiveQuery(() => api.listServiceRequests(shopId), { shopId, tables: ['service_requests'], pollMs: 30_000 });
  const { soundOn, enable } = useStaffAlerts(pending.data, calls.data);

  const reload = () => (pending.reload(), calls.reload());
  const waiting = (pending.data?.length ?? 0) + (calls.data?.filter((c) => c.status === 'open').length ?? 0);
  const tabs: TabItem<TabId>[] = [
    { id: 'orders', label: t('tab_orders'), badge: waiting > 0 ? waiting : undefined },
    { id: 'kitchen', label: t('tab_kitchen') },
    { id: 'tables', label: t('tab_tables') },
    { id: 'soldout', label: t('tab_soldout') },
  ];
  const choose = (id: TabId) => (setTab(id), writeJson(TAB_KEY, id));

  return (
    <div className="flex min-h-full flex-col bg-stone-50">
      {!soundOn && (
        <Banner kind="warn" action={<Button onClick={() => void enable()}>{t('enable_sound_btn')}</Button>}>
          {t('enable_sound')}
        </Banner>
      )}
      <TabBar tabs={tabs} value={tab} onChange={choose} label={t('tabs_label')} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex-1">
        {tab === 'orders' &&
          (pending.data && calls.data ? (
            <OrdersTab shopId={shopId} pending={pending.data} calls={calls.data} reload={reload} />
          ) : (pending.error ?? calls.error) ? (
            <ErrorState error={pending.error ?? calls.error} onRetry={reload} />
          ) : (
            <Loading />
          ))}
        {tab === 'kitchen' && <KitchenView shopId={shopId} />}
        {tab === 'tables' && <TablesTab shopId={shopId} />}
        {tab === 'soldout' && <SoldOutTab shopId={shopId} />}
      </div>
    </div>
  );
}

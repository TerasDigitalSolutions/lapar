// The sales demo shell. Must never import supabase-js (nothing from data/supabase).
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { DataProvider } from '../../data/context';
import { createDemoData } from '../../data/demo';
import type { DemoClock, Entitlements, LaparDemoData, PlanId } from '../../data/types';
import { EntitlementsProvider, ProCtaProvider } from '../../entitlements/hooks';
import { ConfirmDialog, Button, ProLocked, ToastProvider, useToast, inputClass } from '../../ui';
import { CustomerView } from '../customer/CustomerView';
import { ManagerView } from '../manager/ManagerView';
import { StaffView } from '../staff/StaffView';
import { useDemoT } from './messages';
import { startRush } from './rush';

type View = 'customer' | 'staff' | 'manager';
const CLOCKS: DemoClock[] = ['real', 'breakfast', 'lunch', 'afternoon'];

function useWide() {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function Select({ label, value, onChange, children, grow = false }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; grow?: boolean }) {
  return (
    <label className={`flex min-w-0 flex-col text-xs font-semibold text-stone-600 ${grow ? 'flex-1' : ''}`}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} min-h-12 px-2! py-0 font-medium`}>
        {children}
      </select>
    </label>
  );
}

/** Toasts for activity in views the partner is not looking at: new orders waiting for approval and calls. */
function useActivityToasts(demo: LaparDemoData, staffVisible: boolean, resetKey: number) {
  const toast = useToast();
  const t = useDemoT();
  const tRef = useRef(t);
  const visible = useRef(staffVisible);
  useEffect(() => {
    tRef.current = t;
    visible.current = staffVisible;
  });
  useEffect(() => {
    let seen: Set<string> | null = null;
    let alive = true;
    const check = async () => {
      const [orders, calls] = await Promise.all([demo.staff.listPendingOrders(demo.shopId), demo.staff.listServiceRequests(demo.shopId)]);
      if (!alive) return;
      const ids = new Set([...orders.map((o) => o.orderId), ...calls.map((c) => `${c.id}:${c.updatedAt}`)]);
      if (seen && !visible.current) {
        for (const o of orders) if (!seen.has(o.orderId)) toast(tRef.current('toast_order', { table: o.tableLabel }));
        for (const c of calls) if (!seen.has(`${c.id}:${c.updatedAt}`)) toast(tRef.current(`toast_call_${c.reason}`, { table: c.tableLabel }));
      }
      seen = ids;
    };
    void check();
    const off = demo.onChange(() => void check().catch(() => {}));
    return () => {
      alive = false;
      off();
    };
  }, [demo, toast, resetKey]);
}

function Shell({ demo }: { demo: LaparDemoData }) {
  const t = useDemoT();
  const wide = useWide();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [view, setView] = useState<View>('customer');
  const [token, setToken] = useState(demo.tables[0]!.token);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [stopRush, setStopRush] = useState<(() => void) | null>(null);
  const plan = demo.getPlan();
  const pro = plan === 'pro';

  useEffect(() => demo.onChange(bump), [demo]);
  useEffect(() => {
    let live = true;
    void demo.getEntitlements(demo.shopId).then((e) => live && setEntitlements(e));
    return () => {
      live = false;
    };
  }, [demo, plan]);
  useEffect(() => () => stopRush?.(), [stopRush]);

  const staffVisible = wide ? view !== 'manager' : view === 'staff';
  useActivityToasts(demo, staffVisible, resetKey);

  const takeaway = entitlements?.features.takeaway ?? false;
  const tableChoices = demo.tables.filter((x) => x.kind === 'table' || takeaway);
  const activeToken = tableChoices.some((x) => x.token === token) ? token : demo.tables[0]!.token;

  const toggleRush = () => {
    if (stopRush) {
      stopRush();
      setStopRush(null);
    } else {
      setStopRush(() => startRush(demo, activeToken, () => setStopRush(null)));
    }
  };

  const customer = <CustomerView key={`${activeToken}:${resetKey}`} tableToken={activeToken} />;
  const side = view === 'manager' ? <ManagerView key={resetKey} shopId={demo.shopId} /> : <StaffView key={resetKey} shopId={demo.shopId} />;

  return (
    <div className="flex h-dvh flex-col bg-stone-100 text-stone-900">
      <header aria-label={t('bar')} className="shrink-0 border-b border-stone-200 bg-white px-3 py-2">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-1">
          <div className="flex items-center gap-2">
            <h1 className="mr-auto text-lg font-extrabold text-orange-700">{t('title')}</h1>
            <Button variant={stopRush ? 'danger' : 'secondary'} onClick={toggleRush}>
              {stopRush ? t('rush_stop') : t('rush')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmReset(true)}>
              {t('reset')}
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Select grow label={t('plan')} value={plan} onChange={(v) => demo.setPlan(v as PlanId)}>
              <option value="basic">{t('plan_basic')}</option>
              <option value="pro">{t('plan_pro')}</option>
            </Select>
            <Select grow label={t('view')} value={view} onChange={(v) => setView(v as View)}>
              <option value="customer">{t('view_customer')}</option>
              <option value="staff">{t('view_staff')}</option>
              <option value="manager">{t('view_manager')}</option>
            </Select>
            <div className="flex min-w-0 flex-1 flex-col text-xs font-semibold text-stone-600">
              {pro ? (
                <Select grow label={t('clock')} value={demo.getClock()} onChange={(v) => demo.setClock(v as DemoClock)}>
                  {CLOCKS.map((c) => (
                    <option key={c} value={c}>
                      {t(`clock_${c}`)}
                    </option>
                  ))}
                </Select>
              ) : (
                <>
                  <span className="invisible">{t('clock')}</span>
                  <ProLocked feature="timed_menus">{t('clock')}</ProLocked>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {entitlements && (
          <EntitlementsProvider value={entitlements}>
            {wide ? (
              <div className="mx-auto flex h-full max-w-7xl gap-4 p-4">
                <section aria-label={t('phone_frame')} className="flex w-[390px] shrink-0 flex-col gap-2">
                  <Select label={t('table')} value={activeToken} onChange={setToken}>
                    {tableChoices.map((x) => (
                      <option key={x.token} value={x.token}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                  <div className="min-h-0 flex-1 overflow-auto [transform:translateZ(0)] rounded-[2rem] border-8 border-stone-800 bg-white shadow-xl">{customer}</div>
                </section>
                <section aria-label={view === 'manager' ? t('manager_pane') : t('staff_pane')} className="min-w-0 flex-1 overflow-auto [transform:translateZ(0)] rounded-2xl bg-white shadow">
                  {side}
                </section>
              </div>
            ) : (
              <div className="flex h-full flex-col">
                {view === 'customer' && (
                  <div className="shrink-0 bg-stone-50 px-3 pt-2">
                    <Select label={t('table')} value={activeToken} onChange={setToken}>
                      {tableChoices.map((x) => (
                        <option key={x.token} value={x.token}>
                          {x.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-auto bg-white [transform:translateZ(0)]">{view === 'customer' ? customer : side}</div>
              </div>
            )}
          </EntitlementsProvider>
        )}
      </main>

      <ConfirmDialog
        open={confirmReset}
        title={t('reset_title')}
        confirmLabel={t('reset_confirm')}
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          stopRush?.();
          setStopRush(null);
          demo.reset();
          setResetKey((k) => k + 1);
          setConfirmReset(false);
        }}
      >
        {t('reset_body')}
      </ConfirmDialog>
    </div>
  );
}

export function DemoApp() {
  const demo = useMemo(() => createDemoData(), []);
  return (
    <DataProvider value={demo}>
      <ProCtaProvider value={{ kind: 'demo' }}>
        <ToastProvider>
          <Shell demo={demo} />
        </ToastProvider>
      </ProCtaProvider>
    </DataProvider>
  );
}

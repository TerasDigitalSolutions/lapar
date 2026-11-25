import { useState, type ReactNode } from 'react';
import { useData } from '../../data/context';
import { ProCtaProvider, useEntitlements, useFeature, useProCta, type ProCta } from '../../entitlements/hooks';
import type { FeatureKey } from '../../entitlements/keys';
import { focusRing, ProBadge } from '../../ui';
import { useLoad } from './hooks';
import { useManagerT } from './messages';
import { MenuSection } from './MenuSection';
import { PlanSection } from './PlanSection';
import { ExportSection } from './pro/ExportSection';
import { PromosSection } from './pro/PromosSection';
import { ReportsSection } from './pro/ReportsSection';
import { StationsSection } from './pro/StationsSection';
import { TakeawaySection } from './pro/TakeawaySection';
import { UpsellSection } from './pro/UpsellSection';
import { SettingsSection } from './SettingsSection';
import { StaffSection } from './StaffSection';
import { TablesSection } from './TablesSection';
import { TodaySection } from './TodaySection';

const BASIC = ['today', 'menu', 'tables', 'staff', 'settings', 'plan'] as const;
const PRO = [
  { id: 'reports', feature: 'full_reports' },
  { id: 'upsell', feature: 'upsell_report' },
  { id: 'promos', feature: 'promos' },
  { id: 'stations', feature: 'multi_station' },
  { id: 'takeaway', feature: 'takeaway' },
  { id: 'export', feature: 'export_backup' },
] as const satisfies readonly { id: string; feature: FeatureKey }[];
type SectionId = (typeof BASIC)[number] | (typeof PRO)[number]['id'];

function NavButton({ id, label, current, onPick, lock }: { id: SectionId; label: string; current: SectionId; onPick: (id: SectionId) => void; lock?: boolean }) {
  const selected = id === current;
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      onClick={() => onPick(id)}
      className={`inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-4 text-base font-semibold ${focusRing} ${
        selected ? 'bg-orange-600 text-white' : 'bg-stone-200 text-stone-900 hover:bg-stone-300'
      }`}
    >
      {label}
      {lock && <ProBadge />}
    </button>
  );
}

function ProNavButton({ id, feature, label, current, onPick }: { id: SectionId; feature: FeatureKey; label: string; current: SectionId; onPick: (id: SectionId) => void }) {
  const on = useFeature(feature);
  return <NavButton id={id} label={label} current={current} onPick={onPick} lock={!on} />;
}

/** Owner screens. Needs ToastProvider, DataProvider and EntitlementsProvider above it. */
export function ManagerView({ shopId }: { shopId: string }) {
  const t = useManagerT();
  const api = useData();
  const outer = useProCta();
  const [section, setSection] = useState<SectionId>('today');
  const ent = useEntitlements();
  const plan = useLoad(() => api.owner.getShopPlan(shopId), `${shopId}:${JSON.stringify(ent)}`);

  // Same choice as the Plan page: the shop's Ask Teras number, else a neutral message (the demo keeps its own text).
  const number = plan.data?.askTerasWhatsapp ?? null;
  const cta: ProCta = number ? { kind: 'whatsapp', number } : outer.kind === 'demo' ? outer : { kind: 'neutral' };

  const labels: Record<SectionId, string> = {
    today: t('nav_today'),
    menu: t('nav_menu'),
    tables: t('nav_tables'),
    staff: t('nav_staff'),
    settings: t('nav_settings'),
    plan: t('nav_plan'),
    reports: t('nav_reports'),
    upsell: t('nav_upsell'),
    promos: t('nav_promos'),
    stations: t('nav_stations'),
    takeaway: t('nav_takeaway'),
    export: t('nav_export'),
  };

  const body: Record<SectionId, ReactNode> = {
    today: <TodaySection shopId={shopId} />,
    menu: <MenuSection shopId={shopId} />,
    tables: <TablesSection shopId={shopId} />,
    staff: <StaffSection shopId={shopId} />,
    settings: <SettingsSection shopId={shopId} />,
    plan: <PlanSection shopId={shopId} />,
    reports: <ReportsSection shopId={shopId} />,
    upsell: <UpsellSection shopId={shopId} />,
    promos: <PromosSection shopId={shopId} />,
    stations: <StationsSection shopId={shopId} />,
    takeaway: <TakeawaySection shopId={shopId} />,
    export: <ExportSection shopId={shopId} />,
  };

  return (
    <ProCtaProvider value={cta}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <nav aria-label={t('nav_label')} className="flex flex-col gap-2">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {BASIC.map((id) => (
              <NavButton key={id} id={id} label={labels[id]} current={section} onPick={setSection} />
            ))}
          </div>
          <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1">
            <span className="shrink-0 text-sm font-bold tracking-wide text-stone-600 uppercase">{t('nav_pro')}</span>
            {PRO.map((p) => (
              <ProNavButton key={p.id} id={p.id} feature={p.feature} label={labels[p.id]} current={section} onPick={setSection} />
            ))}
          </div>
        </nav>
        <section aria-label={labels[section]}>{body[section]}</section>
      </div>
    </ProCtaProvider>
  );
}

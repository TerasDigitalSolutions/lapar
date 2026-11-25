import { useState } from 'react';
import { useData } from '../../../data/context';
import type { BackupFile } from '../../../data/types';
import { useFeature } from '../../../entitlements/hooks';
import { backupTargets } from '../../../lib/backup';
import { Button, Field, ProLocked } from '../../../ui';
import { useAct } from '../hooks';
import { Card, Heading } from '../parts';
import { fullJson, ordersCsv, paymentsCsv, salesByDayCsv } from './exportFiles';
import { useDateRange, useReportT } from './reportParts';

export function ExportSection({ shopId }: { shopId: string }) {
  const on = useFeature('export_backup');
  if (!on) return <ProLocked feature="export_backup" />;
  return <ExportBody shopId={shopId} />;
}

function ExportBody({ shopId }: { shopId: string }) {
  const t = useReportT();
  const { pro } = useData();
  const { run, busy } = useAct();
  const { from, to, valid, fields } = useDateRange();
  const targets = backupTargets();
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const target = targets.find((x) => x.id === targetId) ?? targets[0];

  const save = (build: () => Promise<BackupFile>) =>
    run(async () => {
      const file = await build();
      await target!.save(file);
      return file.name;
    }).then((r) => r && showName(r.value));
  const [saved, setSaved] = useState<string | null>(null);
  const showName = (name: string) => setSaved(name);

  const disabled = busy || !target;
  return (
    <div className="flex flex-col gap-4">
      <Heading>{t('export_title')}</Heading>
      <p className="text-stone-700">{t('export_hint')}</p>
      {fields}
      {targets.length > 1 ? (
        <Field label={t('save_to')}>
          {(p) => (
            <select {...p} className="min-h-12 rounded-xl border border-stone-300 bg-white px-3" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {targets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        <p className="text-sm text-stone-600">
          {t('save_to')}: {target?.label}
        </p>
      )}
      <Card className="flex flex-col gap-3">
        <Button variant="secondary" block disabled={disabled || !valid} onClick={() => void save(() => ordersCsv(pro, shopId, from, to))}>
          {t('export_orders')}
        </Button>
        <Button variant="secondary" block disabled={disabled || !valid} onClick={() => void save(() => paymentsCsv(pro, shopId, from, to))}>
          {t('export_payments')}
        </Button>
        <Button variant="secondary" block disabled={disabled || !valid} onClick={() => void save(() => salesByDayCsv(pro, shopId, from, to))}>
          {t('export_sales')}
        </Button>
        <Button block disabled={disabled} onClick={() => void save(() => fullJson(pro, shopId))}>
          {t('export_json')}
        </Button>
      </Card>
      {saved && (
        <p role="status" className="text-stone-700">
          {t('export_done', { name: saved })}
        </p>
      )}
    </div>
  );
}

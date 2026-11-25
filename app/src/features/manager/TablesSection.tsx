import { useEffect, useState } from 'react';
import { useData } from '../../data/context';
import type { TableRow } from '../../data/types';
import { qrSvg, tableQrUrl } from '../../lib/qr';
import { Button, EmptyState, ErrorState, Field, inputClass, LimitBadge, Loading, Sheet } from '../../ui';
import { useAct, useLoad } from './hooks';
import { useManagerT } from './messages';
import { Card, Heading, Tag } from './parts';
import { QrPrint } from './QrPrint';

const LABEL_MAX = 20;

export function TablesSection({ shopId }: { shopId: string }) {
  const t = useManagerT();
  const api = useData();
  const { run, busy } = useAct();
  const list = useLoad(() => api.owner.listTables(shopId), shopId);
  const settings = useLoad(() => api.owner.getShopSettings(shopId), shopId);
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [rename, setRename] = useState<{ table: TableRow; label: string; error: string | null } | null>(null);
  const [qrId, setQrId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [printing, setPrinting] = useState<TableRow[] | null>(null);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done);
    window.print();
    return () => window.removeEventListener('afterprint', done);
  }, [printing]);

  if (!list.data) return list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <Loading />;
  const tables = list.data.filter((x) => x.kind === 'table');
  const active = tables.filter((x) => x.active);
  const qrTable = tables.find((x) => x.id === qrId) ?? null;

  const checkLabel = (value: string, others: TableRow[]): { label: string; error: string | null } => {
    const label = value.trim();
    if (!label) return { label, error: t('label_required') };
    if (label.length > LABEL_MAX) return { label, error: t('label_too_long', { max: LABEL_MAX }) };
    if (others.some((o) => o.label.toLowerCase() === label.toLowerCase())) return { label, error: t('label_taken') };
    return { label, error: null };
  };

  const add = async () => {
    const { label, error } = checkLabel(newLabel, tables);
    setAddError(error);
    if (error) return;
    if (await run(() => api.owner.saveTable({ shopId, label, kind: 'table' }), t('table_added'))) {
      setNewLabel('');
      list.reload();
    }
  };

  const saveRename = async () => {
    if (!rename) return;
    const { label, error } = checkLabel(rename.label, tables.filter((x) => x.id !== rename.table.id));
    if (error) return setRename({ ...rename, error });
    if (await run(() => api.owner.saveTable({ id: rename.table.id, shopId, label }), t('saved'))) {
      setRename(null);
      list.reload();
    }
  };

  const setActive = async (table: TableRow, value: boolean) => {
    if (await run(() => api.owner.saveTable({ id: table.id, shopId, label: table.label, active: value }))) list.reload();
  };

  const regenerate = async () => {
    if (!qrTable) return;
    if (await run(() => api.owner.regenerateTableToken(qrTable.id), t('qr_regenerated'))) {
      setConfirming(false);
      list.reload();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Heading aside={<LimitBadge used={active.length} limitKey="max_tables" />}>{t('tables_title')}</Heading>

      <Card className="flex flex-col gap-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label={t('table_name')} hint={t('table_name_hint')} error={addError}>
            {(p) => <input {...p} className={inputClass} value={newLabel} maxLength={LABEL_MAX + 10} onChange={(e) => setNewLabel(e.target.value)} />}
          </Field>
          <Button type="submit" disabled={busy}>
            {t('add_table')}
          </Button>
        </form>
      </Card>

      {tables.length === 0 ? (
        <EmptyState title={t('no_tables')}>{t('no_tables_body')}</EmptyState>
      ) : (
        <>
          <Button variant="secondary" disabled={active.length === 0} onClick={() => setPrinting(active)}>
            {t('print_all')}
          </Button>
          <ul className="flex flex-col gap-3">
            {tables.map((table) => (
              <li key={table.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-stone-900">{table.label}</span>
                    {!table.active && <Tag>{t('inactive')}</Tag>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      aria-label={t('show_qr_for', { name: table.label })}
                      onClick={() => {
                        setConfirming(false);
                        setQrId(table.id);
                      }}
                    >
                      {t('show_qr')}
                    </Button>
                    <Button variant="secondary" aria-label={t('rename_named', { name: table.label })} onClick={() => setRename({ table, label: table.label, error: null })}>
                      {t('rename')}
                    </Button>
                    <Button variant="ghost" disabled={busy} aria-label={`${table.active ? t('deactivate') : t('reactivate')} ${table.label}`} onClick={() => void setActive(table, !table.active)}>
                      {table.active ? t('deactivate') : t('reactivate')}
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <Sheet open={!!rename} onClose={() => setRename(null)} title={t('rename_table')}>
        {rename && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveRename();
            }}
          >
            <Field label={t('table_name')} error={rename.error}>
              {(p) => <input {...p} className={inputClass} value={rename.label} onChange={(e) => setRename({ ...rename, label: e.target.value, error: null })} />}
            </Field>
            <Button type="submit" disabled={busy}>
              {t('save')}
            </Button>
          </form>
        )}
      </Sheet>

      <Sheet open={!!qrTable} onClose={() => setQrId(null)} title={qrTable ? t('qr_title', { name: qrTable.label }) : ''}>
        {qrTable && !confirming && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-64 max-w-full" dangerouslySetInnerHTML={{ __html: qrSvg(tableQrUrl(qrTable.token)) }} />
            <p className="text-center text-sm break-all text-stone-600">{tableQrUrl(qrTable.token)}</p>
            <Button block onClick={() => setPrinting([qrTable])}>
              {t('print_this')}
            </Button>
            <Button block variant="secondary" onClick={() => setConfirming(true)}>
              {t('regenerate')}
            </Button>
          </div>
        )}
        {qrTable && confirming && (
          <div className="flex flex-col gap-4">
            <p className="text-stone-800">{t('regenerate_warning', { name: qrTable.label })}</p>
            <Button block variant="danger" disabled={busy} onClick={() => void regenerate()}>
              {t('regenerate_confirm')}
            </Button>
            <Button block variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              {t('keep_old')}
            </Button>
          </div>
        )}
      </Sheet>

      {printing && <QrPrint shopName={settings.data?.name ?? ''} tables={printing} />}
    </div>
  );
}

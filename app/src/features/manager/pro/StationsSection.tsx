import { useRef, useState } from 'react';
import { useData } from '../../../data/context';
import { CORE_BOARD_STATUSES, isLaparError, type StationRow } from '../../../data/types';
import { useFeature } from '../../../entitlements/hooks';
import { Button, EmptyState, ErrorState, Field, IconButton, inputClass, LimitBadge, Loading, ProLocked, Sheet } from '../../../ui';
import { useAct, useLoad } from '../hooks';
import { Card, Heading, Tag, UpDown } from '../parts';
import { addAfter, canAdd, canRemove, columnNameError, COLUMN_NAME_MAX, COLUMNS_MAX, moveColumn, toInput, type Col } from './columns';
import { useProT } from './messages';

const NAME_MAX = 30;

export function StationsSection({ shopId }: { shopId: string }) {
  const on = useFeature('multi_station');
  if (!on) return <ProLocked feature="multi_station" />;
  return <Stations shopId={shopId} />;
}

function Stations({ shopId }: { shopId: string }) {
  const t = useProT();
  const api = useData();
  const columnsOn = useFeature('custom_columns');
  const { run, busy } = useAct();
  const menu = useLoad(() => api.owner.getMenuEditor(shopId), shopId);
  const [name, setName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [rename, setRename] = useState<{ station: StationRow; name: string; error: string | null } | null>(null);
  const [columnsFor, setColumnsFor] = useState<StationRow | null>(null);

  if (!menu.data) return menu.error ? <ErrorState error={menu.error} onRetry={menu.reload} /> : <Loading />;
  const stations = [...menu.data.stations].sort((a, b) => a.sort - b.sort);
  const active = stations.filter((s) => s.active);

  if (columnsFor) return <ColumnEditor station={columnsFor} onBack={() => setColumnsFor(null)} />;

  const checkName = (value: string): { name: string; error: string | null } => {
    const n = value.trim();
    return { name: n, error: !n ? t('name_required') : n.length > NAME_MAX ? t('name_too_long', { max: NAME_MAX }) : null };
  };

  const add = async () => {
    const { name: n, error } = checkName(name);
    setAddError(error);
    if (error) return;
    if (await run(() => api.pro.saveStation({ shopId, name: n }), t('station_added'))) {
      setName('');
      menu.reload();
    }
  };

  const saveRename = async () => {
    if (!rename) return;
    const { name: n, error } = checkName(rename.name);
    if (error) return setRename({ ...rename, error });
    if (await run(() => api.pro.saveStation({ id: rename.station.id, shopId, name: n }), t('saved'))) {
      setRename(null);
      menu.reload();
    }
  };

  const setActive = async (s: StationRow, value: boolean) => {
    const done = await run(
      () => api.pro.saveStation({ id: s.id, shopId, name: s.name, active: value }),
      undefined,
      (e) => (isLaparError(e, 'invalid_input') ? t('last_station') : null),
    );
    if (done) menu.reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <Heading aside={<LimitBadge used={active.length} limitKey="max_stations" />}>{t('stations_title')}</Heading>

      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label={t('station_name')} hint={t('station_name_hint')} error={addError}>
            {(p) => <input {...p} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Button type="submit" disabled={busy}>
            {t('add_station')}
          </Button>
        </form>
      </Card>

      {stations.length === 0 ? (
        <EmptyState title={t('station_name')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {stations.map((s) => (
            <li key={s.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-stone-900">{s.name}</span>
                  {!s.active && <Tag>{t('inactive')}</Tag>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {columnsOn && (
                    <Button variant="secondary" aria-label={t('columns_for', { name: s.name })} onClick={() => setColumnsFor(s)}>
                      {t('columns_for', { name: s.name })}
                    </Button>
                  )}
                  <Button variant="secondary" aria-label={t('rename_named', { name: s.name })} onClick={() => setRename({ station: s, name: s.name, error: null })}>
                    {t('rename')}
                  </Button>
                  <Button variant="ghost" disabled={busy} aria-label={`${s.active ? t('deactivate') : t('reactivate')} ${s.name}`} onClick={() => void setActive(s, !s.active)}>
                    {s.active ? t('deactivate') : t('reactivate')}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!rename} onClose={() => setRename(null)} title={t('rename_station')}>
        {rename && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveRename();
            }}
          >
            <Field label={t('station_name')} error={rename.error}>
              {(p) => <input {...p} className={inputClass} value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value, error: null })} />}
            </Field>
            <Button type="submit" disabled={busy}>
              {t('save')}
            </Button>
          </form>
        )}
      </Sheet>
    </div>
  );
}

/** Columns of one station's kitchen board. Without saved columns it starts from the four standard steps. */
function ColumnEditor({ station, onBack }: { station: StationRow; onBack: () => void }) {
  const t = useProT();
  const api = useData();
  const { run, busy } = useAct();
  const keys = useRef(0);
  const nextKey = () => `c${++keys.current}`;
  const loaded = useLoad(async (): Promise<Col[]> => {
    const rows = await api.pro.getBoardColumns(station.id);
    if (rows.length) return [...rows].sort((a, b) => a.sort - b.sort).map((r) => ({ key: r.id, id: r.id, name: r.name, coreStatus: r.coreStatus }));
    return CORE_BOARD_STATUSES.map((s) => ({ key: s, id: null, name: t(`step_${s}`), coreStatus: s }));
  }, station.id);
  const [edited, setEdited] = useState<Col[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cols = edited ?? loaded.data;

  if (!cols) return loaded.error ? <ErrorState error={loaded.error} onRetry={loaded.reload} /> : <Loading />;

  const change = (next: Col[] | null, blocked?: string) => {
    if (!next) return setNotice(blocked ?? null);
    setNotice(null);
    setEdited(next);
  };

  const remove = (i: number) => {
    const col = cols[i]!;
    if (!canRemove(cols, i)) return setNotice(t('last_of_step', { name: col.name || t('new_column') }));
    change(cols.filter((_, j) => j !== i));
  };

  const save = async () => {
    const problem = columnNameError(cols);
    if (problem) return setNotice(t(problem, { max: COLUMN_NAME_MAX }));
    const rows = await run(() => api.pro.setBoardColumns(station.id, toInput(cols)), t('columns_saved'));
    if (rows) {
      setNotice(null);
      setEdited(rows.value.map((r) => ({ key: r.id, id: r.id, name: r.name, coreStatus: r.coreStatus })));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Heading aside={<Button variant="secondary" onClick={onBack}>{t('back')}</Button>}>{t('columns_title', { name: station.name })}</Heading>
      <p className="text-stone-700">{t('columns_hint')}</p>
      <ul className="flex flex-col gap-3">
        {cols.map((c, i) => {
          const label = c.name || t('new_column');
          return (
            <li key={c.key}>
              <Card className="flex flex-col gap-2">
                <Field label={t('column_name', { n: i + 1 })}>
                  {(p) => <input {...p} className={inputClass} maxLength={COLUMN_NAME_MAX + 10} value={c.name} onChange={(e) => setEdited(cols.map((x) => (x === c ? { ...x, name: e.target.value } : x)))} />}
                </Field>
                <p className="text-sm text-stone-600">{t('column_step', { step: t(`step_${c.coreStatus}`) })}</p>
                <div className="flex flex-wrap items-center gap-1">
                  <UpDown
                    index={i}
                    count={cols.length}
                    name={label}
                    onMove={(d) => change(moveColumn(cols, i, d), t('cannot_move', { name: label }))}
                  />
                  <Button variant="secondary" disabled={!canAdd(cols)} aria-label={t('add_column_after', { name: label })} onClick={() => change(addAfter(cols, i, nextKey()))}>
                    +
                  </Button>
                  <IconButton label={t('remove_column', { name: label })} onClick={() => remove(i)}>
                    ✕
                  </IconButton>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      {!canAdd(cols) && <p className="text-sm text-stone-600">{t('too_many_columns', { max: COLUMNS_MAX })}</p>}
      {notice && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {notice}
        </p>
      )}
      <Button disabled={busy} onClick={() => void save()}>
        {t('save_columns')}
      </Button>
    </div>
  );
}

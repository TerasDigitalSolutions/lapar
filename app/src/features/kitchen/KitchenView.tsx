import { useCallback, useEffect, useRef, useState } from 'react';
import { useData } from '../../data/context';
import { useLiveQuery, useOnline, usePageVisible, usePolling } from '../../data/hooks';
import type { BoardColumnDTO, BoardLineDTO } from '../../data/types';
import { isAudioRunning, onAudioStateChange, playOrderAlert, unlockAudio } from '../../lib/audio';
import { minutesSince } from '../../lib/time';
import type { StationRow } from '../../data/types';
import { useFeature } from '../../entitlements/hooks';
import { readJson, writeJson } from '../../lib/storage';
import { Banner, Button, ConfirmDialog, ErrorState, IconButton, Loading, Segmented, Sheet } from '../../ui';
import { PrintSheet, ticketSlips, type Slip } from '../print';
import { useErrorText } from '../staff/errors';
import { ageClass, columnIndexOf, effectiveColumns, nextMove, prevMove, type AgeClass, type Move } from './columns';
import { useKitchenT } from './messages';

// Start shift shows once per page load, not on every remount (view/plan/station switch).
let shiftStarted = false;

const STATION_KEY = 'lapar.kitchen.station';

/** Station picker (Pro: multi_station); the choice is remembered per device. Basic shows the one board. */
export function KitchenView({ shopId }: { shopId: string }) {
  const api = useData();
  const multi = useFeature('multi_station');
  const [stations, setStations] = useState<StationRow[] | null>(null);
  const [stationId, setStationId] = useState<string | null>(() => readJson<string | null>(STATION_KEY, null));

  useEffect(() => {
    if (!multi) return;
    let live = true;
    api.staff.listStations(shopId).then(
      (list) => {
        if (!live) return;
        setStations(list);
        setStationId((id) => (list.some((s) => s.id === id) ? id : (list[0]?.id ?? null)));
      },
      () => live && setStations([]),
    );
    return () => {
      live = false;
    };
  }, [api, shopId, multi]);

  if (multi && !stations) return <Loading />;
  const choose = (id: string) => (setStationId(id), writeJson(STATION_KEY, id));
  return <KitchenBoard key={multi ? stationId : 'default'} shopId={shopId} stationId={multi ? stationId : null} stations={multi ? (stations ?? []) : []} onStation={choose} />;
}

const CORE_KEY = { new: 'col_new', preparing: 'col_preparing', cooking: 'col_cooking', ready: 'col_ready' } as const;
const AGE_STYLE: Record<AgeClass, string> = {
  ok: 'border-stone-400 bg-white text-stone-950 shadow-md',
  amber: 'border-amber-700 bg-amber-300 text-stone-950 shadow-md',
  red: 'border-red-950 bg-red-700 text-white shadow-md',
};

function KitchenBoard({ shopId, stationId, stations, onStation }: { shopId: string; stationId: string | null; stations: StationRow[]; onStation: (id: string) => void }) {
  const t = useKitchenT();
  const errorText = useErrorText();
  const printing = useFeature('printing');
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const api = useData();
  const online = useOnline();
  const visible = usePageVisible();
  const [started, setStarted] = useState(shiftStarted);
  const [sound, setSound] = useState(false);
  const [, setAudioTick] = useState(0);
  const [wakeOk, setWakeOk] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<BoardLineDTO | null>(null);
  const [cancelFor, setCancelFor] = useState<BoardLineDTO | null>(null);
  const [nowMs, setNowMs] = useState(Date.now);
  const offsetMs = useRef(0);
  const seen = useRef<Set<string> | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);

  // Minutes use the server's clock, so a wrong tablet clock does not show wrong ages.
  const q = useLiveQuery(
    async () => {
      const b = await api.staff.getBoard(shopId, stationId);
      offsetMs.current = new Date(b.serverNow).getTime() - Date.now();
      setNowMs(new Date(b.serverNow).getTime());
      return b;
    },
    { shopId, tables: ['orders', 'order_items'] },
  );
  const board = q.data;
  usePolling(() => setNowMs(Date.now() + offsetMs.current), 30_000);

  // Sound on new cards, but not for the first load.
  useEffect(() => {
    if (!board) return;
    if (seen.current && board.lines.some((l) => l.status === 'new' && !seen.current!.has(l.id))) playOrderAlert();
    seen.current = new Set(board.lines.map((l) => l.id));
  }, [board]);

  // Wake lock: requested on start and again whenever the page becomes visible.
  useEffect(() => {
    if (!started || !visible) return;
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(
      (s) => ((wake.current = s), setWakeOk(true)),
      () => setWakeOk(false),
    );
    return () => void wake.current?.release().catch(() => undefined);
  }, [started, visible]);

  const enableSound = useCallback(async () => setSound(await unlockAudio()), []);
  useEffect(() => onAudioStateChange(() => setAudioTick((n) => n + 1)), []);
  const start = async () => {
    shiftStarted = true;
    setStarted(true);
    void enableSound();
  };

  const advance = async (line: BoardLineDTO, move: Move) => {
    setBusy((b) => new Set(b).add(line.id));
    setActionError(null);
    try {
      await api.staff.advanceItem(line.id, move.to, move.columnId);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy((b) => (b.delete(line.id), new Set(b)));
      q.reload();
    }
  };

  if (!board) return q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : <Loading />;

  const columns = effectiveColumns(board.columns);
  const now = new Date(nowMs);
  const colName = (c: BoardColumnDTO) => c.name ?? t(CORE_KEY[c.coreStatus]);
  const soundOn = (sound || shiftStarted) && isAudioRunning();
  const backCol = menuFor ? columns[columnIndexOf(menuFor, columns) - 1] : undefined;
  const back = menuFor ? prevMove(menuFor, columns) : null;

  return (
    <div className="flex min-h-dvh flex-col gap-3 bg-stone-200 p-3 text-stone-950">
      {!started && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-stone-900 p-8 text-center text-white">
          <h1 className="text-4xl font-extrabold">{t('start_title')}</h1>
          <p className="max-w-md text-xl">{t('start_body')}</p>
          <Button onClick={() => void start()} className="min-h-24 px-16 text-3xl">
            {t('start_button')}
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2 empty:hidden">
        {started && !soundOn && (
          <Banner
            kind="warn"
            action={
              <Button variant="secondary" onClick={() => void enableSound()}>
                {t('banner_sound_action')}
              </Button>
            }
          >
            {t('banner_sound')}
          </Banner>
        )}
        {started && (!wakeOk || !navigator.wakeLock) && <Banner kind="warn">{t('banner_wake')}</Banner>}
        {((!online && api.kind !== 'demo') || q.connection === 'offline') && <Banner kind="error">{t('banner_offline')}</Banner>}
        {actionError && <Banner kind="error">{actionError}</Banner>}
      </div>
      {stations.length > 1 && <Segmented label={t('station_picker')} options={stations.map((s) => ({ value: s.id, label: s.name }))} value={board.stationId} onChange={onStation} />}
      <div className="flex flex-1 flex-col gap-4 md:flex-row">
        {columns.map((col, ci) => {
          const lines = board.lines.filter((l) => columnIndexOf(l, columns) === ci);
          const nextCol = columns[ci + 1];
          const nextName = nextCol ? colName(nextCol) : t('served');
          return (
            <section key={col.id ?? col.coreStatus} aria-label={colName(col)} className="flex min-w-0 flex-1 flex-col gap-3">
              <h2 className="rounded-2xl border-l-8 border-orange-600 bg-stone-900 px-4 py-3 text-2xl font-extrabold text-white shadow-md">
                {colName(col)} <span className="opacity-70">({lines.length})</span>
              </h2>
              {lines.length === 0 && <p className="px-2 text-lg text-stone-600">{t('empty_column')}</p>}
              {lines.map((line) => {
                const mins = minutesSince(line.approvedAt, now);
                const age = ageClass(mins);
                const label = line.tableKind === 'counter' && line.pickupNo != null ? `#${line.pickupNo}` : line.tableLabel;
                return (
                  <article key={line.id} data-age={age} className={`relative flex items-stretch rounded-2xl border-4 ${AGE_STYLE[age]}`}>
                    <button
                      type="button"
                      disabled={busy.has(line.id)}
                      onClick={() => void advance(line, nextMove(line, columns))}
                      aria-label={`${line.qty} × ${line.name}. ${t('next_to', { name: nextName })}. ${label}, ${t('position', { n: line.position, total: line.positionOf })}, ${t('minutes', { n: mins })}`}
                      className="min-h-28 min-w-0 flex-1 p-4 pr-16 text-left disabled:opacity-60"
                    >
                      <span className="block text-2xl font-extrabold">
                        {line.qty} × {line.name}
                      </span>
                      {line.options.length > 0 && <span className="block text-xl font-semibold">{line.options.map((o) => o.name).join(', ')}</span>}
                      {line.parentName && <span className="block text-lg">{t('from_set', { name: line.parentName })}</span>}
                      {line.note && <span className="mt-1 block rounded bg-black/15 px-2 py-1 text-xl font-bold">{line.note}</span>}
                      {/* Each part stays whole; the line wraps between parts in narrow tablet columns. */}
                      <span className="mt-2 flex flex-wrap items-baseline gap-x-3 text-lg font-bold">
                        <span className="whitespace-nowrap text-xl">{label}</span>
                        <span className="whitespace-nowrap">{t('position', { n: line.position, total: line.positionOf })}</span>
                        <span className="whitespace-nowrap">{t('minutes', { n: mins })}</span>
                      </span>
                    </button>
                    <IconButton label={t('menu_open', { name: line.name })} onClick={() => setMenuFor(line)} className="absolute right-1 top-1 size-12 text-2xl text-inherit">
                      ⋯
                    </IconButton>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor ? t('menu_title', { name: menuFor.name }) : ''}>
        {menuFor && (
          <div className="flex flex-col gap-3">
            {back && backCol && (
              <Button
                variant="secondary"
                onClick={() => {
                  void advance(menuFor, back);
                  setMenuFor(null);
                }}
              >
                {t('move_back', { name: colName(backCol) })}
              </Button>
            )}
            {printing && (
              <Button
                variant="secondary"
                onClick={() => {
                  const order = board.lines.filter((l) => l.orderId === menuFor.orderId);
                  const place = menuFor.tableKind === 'counter' && menuFor.pickupNo != null ? `#${menuFor.pickupNo}` : menuFor.tableLabel;
                  setSlips(ticketSlips({ place, createdAt: menuFor.approvedAt, pickupAt: null, lines: order }, [{ id: board.stationId, name: board.stationName }]));
                  setMenuFor(null);
                }}
              >
                {t('print_ticket')}
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => {
                setCancelFor(menuFor);
                setMenuFor(null);
              }}
            >
              {t('cancel_item')}
            </Button>
          </div>
        )}
      </Sheet>
      <PrintSheet slips={slips} onClose={() => setSlips(null)} />
      <ConfirmDialog
        open={!!cancelFor}
        title={cancelFor ? t('cancel_title', { name: cancelFor.name }) : ''}
        confirmLabel={t('cancel_confirm')}
        cancelLabel={t('keep')}
        danger
        onCancel={() => setCancelFor(null)}
        onConfirm={() => {
          if (cancelFor) void advance(cancelFor, { to: 'cancelled', columnId: null });
          setCancelFor(null);
        }}
      >
        {t('cancel_body')}
      </ConfirmDialog>
    </div>
  );
}

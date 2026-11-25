import { useCallback, useEffect, useState } from 'react';
import { useData } from '../../data/context';
import { toLaparError, usePolling } from '../../data/hooks';
import type { LaparError, PickupBoardDTO } from '../../data/types';
import { getLocale, setLocale, type Locale } from '../../i18n';
import { Button, Loading, Segmented } from '../../ui';
import { useT } from './messages';

/** TV / tablet board: huge numbers in two columns, polled every 5 s. Numbers only, no personal data. */
export function PickupBoardView({ boardToken }: { boardToken: string }) {
  const data = useData();
  const t = useT();
  const [board, setBoard] = useState<PickupBoardDTO | null>(null);
  const [error, setError] = useState<LaparError | null>(null);
  const [full, setFull] = useState(false);

  const load = useCallback(
    () =>
      data.customer.getPickupBoard(boardToken).then(
        (b) => (setBoard(b), setError(null)),
        (e: unknown) => setError(toLaparError(e)),
      ),
    [data, boardToken],
  );
  useEffect(() => void load(), [load]);
  usePolling(load, 5_000);
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);

  const toggleFull = () => void (document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.());

  if (!board) {
    if (!error) return <Loading />;
    return (
      <p role="alert" className="p-8 text-2xl font-semibold text-stone-800">
        {error.code === 'not_found' ? t('not_found') : error.code === 'feature_not_enabled' ? t('not_enabled') : t('error')}
      </p>
    );
  }

  const column = (id: 'preparing' | 'ready', numbers: number[], tone: string) => (
    <section aria-labelledby={`pb-${id}`} className={`flex flex-1 flex-col rounded-3xl p-6 ${tone}`}>
      <h2 id={`pb-${id}`} className="mb-4 text-center text-4xl font-black uppercase tracking-wide md:text-6xl">
        {t(id)}
      </h2>
      {numbers.length === 0 ? (
        <p className="text-center text-3xl text-stone-600">{t('none')}</p>
      ) : (
        <ul aria-labelledby={`pb-${id}`} className="grid grid-cols-2 content-start gap-4 text-center">
          {numbers.map((n) => (
            <li key={n} className="text-7xl font-black tabular-nums leading-tight md:text-9xl">
              {n}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <main className="flex min-h-dvh flex-col gap-4 bg-white p-4 text-stone-900">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold md:text-5xl">{board.shopName}</h1>
        <div className="flex items-center gap-3">
          <div className="w-44">
            <Segmented<Locale>
              label={t('language')}
              value={getLocale()}
              onChange={setLocale}
              options={[
                { value: 'en', label: t('lang_en') },
                { value: 'ms', label: t('lang_ms') },
                { value: 'zh', label: t('lang_zh') },
              ]}
            />
          </div>
          <Button variant="secondary" onClick={toggleFull}>
            {full ? t('exit_fullscreen') : t('fullscreen')}
          </Button>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 md:flex-row">
        {column('preparing', board.preparing, 'bg-amber-100')}
        {column('ready', board.ready, 'bg-green-100')}
      </div>
    </main>
  );
}

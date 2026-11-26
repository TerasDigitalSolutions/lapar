import { useT } from './messages';

export default function Landing() {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-5 py-10 sm:py-16">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-stone-600">{t('brand')}</p>
        <h1 className="mt-2 text-5xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-lg text-stone-700">{t('tagline')}</p>
      </header>
      <a
        href="./demo/"
        className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-orange-700 shadow-md px-6 text-lg font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 active:bg-orange-800"
      >
        {t('cta')}
      </a>
      <ul className="grid gap-3 sm:grid-cols-3">
        {(['f1', 'f2', 'f3'] as const).map((k) => (
          <li key={k} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm text-stone-800">
            {t(k)}
          </li>
        ))}
      </ul>
      <p className="text-sm text-stone-600">{t('note')}</p>
    </main>
  );
}

import type { HHMM, IsoWeekday, Translations } from '../../../data/types';
import { Field, focusRing, inputClass } from '../../../ui';
import { useProT } from './messages';

const LANGS = ['ms', 'zh'] as const;
export const ALL_DAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Sets one translated field; empty text removes it, and a language with nothing left is dropped. */
export function setTranslation(tr: Translations | undefined, lang: 'ms' | 'zh', field: 'name' | 'description', value: string): Translations {
  const next: Translations = { ...tr };
  const entry = { ...next[lang], [field]: value.trim() === '' ? undefined : value };
  const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length) next[lang] = clean;
  else delete next[lang];
  return next;
}

/** Malay and Chinese name (and optionally description) inputs. Callers render it only with `multi_language_menu` on. */
export function TranslationFields({ value, onChange, description }: { value: Translations | undefined; onChange: (t: Translations) => void; description?: boolean }) {
  const t = useProT();
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-stone-200 p-3">
      <legend className="px-1 text-base font-semibold text-stone-800">{t('tr_title')}</legend>
      <p className="text-sm text-stone-600">{t('tr_hint')}</p>
      {LANGS.map((lang) => (
        <div key={lang} className="flex flex-col gap-3">
          <Field label={t(`tr_${lang}_name`)}>
            {(p) => <input {...p} className={inputClass} value={value?.[lang]?.name ?? ''} onChange={(e) => onChange(setTranslation(value, lang, 'name', e.target.value))} />}
          </Field>
          {description && (
            <Field label={t(`tr_${lang}_desc`)}>
              {(p) => <textarea {...p} className={inputClass} rows={2} value={value?.[lang]?.description ?? ''} onChange={(e) => onChange(setTranslation(value, lang, 'description', e.target.value))} />}
            </Field>
          )}
        </div>
      ))}
    </fieldset>
  );
}

/** Weekday toggles; the last selected day cannot be switched off (a window needs a day). */
export function DaysField({ value, onChange, error }: { value: IsoWeekday[]; onChange: (days: IsoWeekday[]) => void; error?: string | null }) {
  const t = useProT();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-base font-semibold text-stone-800">{t('days')}</legend>
      <div className="flex flex-wrap gap-2">
        {ALL_DAYS.map((d) => {
          const on = value.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b))}
              className={`min-h-12 min-w-12 rounded-xl border px-3 text-base font-semibold ${focusRing} ${on ? 'border-orange-600 bg-orange-600 text-white' : 'border-stone-300 bg-white text-stone-900'}`}
            >
              {t(`day_${d}`)}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** From and until time inputs (24h `HH:MM`). */
export function TimeRange({ from, to, onChange }: { from: HHMM; to: HHMM; onChange: (from: HHMM, to: HHMM) => void }) {
  const t = useProT();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-3">
        <Field label={t('start_time')}>{(p) => <input {...p} type="time" className={inputClass} value={from} onChange={(e) => onChange(e.target.value, to)} />}</Field>
        <Field label={t('end_time')}>{(p) => <input {...p} type="time" className={inputClass} value={to} onChange={(e) => onChange(from, e.target.value)} />}</Field>
      </div>
      <p className="text-sm text-stone-600">{t('window_hint')}</p>
    </div>
  );
}

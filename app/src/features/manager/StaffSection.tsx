import { useState } from 'react';
import { useData } from '../../data/context';
import { isLaparError, type StaffRow } from '../../data/types';
import { Button, EmptyState, ErrorState, Field, inputClass, LimitBadge, Loading, Sheet } from '../../ui';
import { useAct, useLoad } from './hooks';
import { useManagerT } from './messages';
import { Card, Heading, Tag } from './parts';

const PIN = /^\d{4,6}$/;
const NAME_MAX = 40;

export function StaffSection({ shopId }: { shopId: string }) {
  const t = useManagerT();
  const api = useData();
  const { run, busy } = useAct();
  const list = useLoad(() => api.owner.listStaff(shopId), shopId);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ name?: string; pin?: string }>({});
  const [reset, setReset] = useState<{ member: StaffRow; pin: string; error: string | null } | null>(null);

  if (!list.data) return list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <Loading />;
  const staff = list.data;
  const activeCount = staff.filter((s) => s.active).length;
  const pinError = (e: unknown) => (isLaparError(e, 'duplicate_pin') ? t('pin_taken') : null);

  const add = async () => {
    const next = { name: name.trim() ? undefined : t('name_required'), pin: PIN.test(pin) ? undefined : t('pin_invalid') };
    if (name.trim().length > NAME_MAX) next.name = t('name_too_long', { max: NAME_MAX });
    setErrors(next);
    if (next.name || next.pin) return;
    if (await run(() => api.owner.addStaff(shopId, name.trim(), pin), t('staff_added'), pinError)) {
      setName('');
      setPin('');
      list.reload();
    }
  };

  const saveReset = async () => {
    if (!reset) return;
    if (!PIN.test(reset.pin)) return setReset({ ...reset, error: t('pin_invalid') });
    if (await run(() => api.owner.resetStaffPin(reset.member.id, reset.pin), t('pin_changed'), pinError)) setReset(null);
  };

  const setActive = async (member: StaffRow, active: boolean) => {
    if (await run(() => api.owner.updateStaff(member.id, { active }))) list.reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <Heading aside={<LimitBadge used={activeCount} limitKey="max_staff" />}>{t('staff_title')}</Heading>
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label={t('staff_name')} error={errors.name}>
            {(p) => <input {...p} className={inputClass} value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={t('staff_pin')} hint={t('pin_hint')} error={errors.pin}>
            {(p) => (
              <input {...p} className={inputClass} value={pin} inputMode="numeric" autoComplete="off" maxLength={6} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            )}
          </Field>
          <Button type="submit" disabled={busy}>
            {t('add_staff')}
          </Button>
        </form>
      </Card>

      {staff.length === 0 ? (
        <EmptyState title={t('no_staff')}>{t('no_staff_body')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {staff.map((m) => (
            <li key={m.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-stone-900">{m.name}</span>
                  {!m.active && <Tag>{t('inactive')}</Tag>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" aria-label={t('reset_pin_for', { name: m.name })} onClick={() => setReset({ member: m, pin: '', error: null })}>
                    {t('reset_pin')}
                  </Button>
                  <Button variant="ghost" disabled={busy} aria-label={`${m.active ? t('deactivate') : t('reactivate')} ${m.name}`} onClick={() => void setActive(m, !m.active)}>
                    {m.active ? t('deactivate') : t('reactivate')}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!reset} onClose={() => setReset(null)} title={reset ? t('reset_pin_title', { name: reset.member.name }) : ''}>
        {reset && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveReset();
            }}
          >
            <Field label={t('new_pin')} hint={t('pin_hint')} error={reset.error}>
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  value={reset.pin}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  onChange={(e) => setReset({ ...reset, pin: e.target.value.replace(/\D/g, ''), error: null })}
                />
              )}
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

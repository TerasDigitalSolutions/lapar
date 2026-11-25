import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { EntitlementsProvider, ProCtaProvider } from '../entitlements/hooks';
import { PLAN_DEFAULTS } from '../entitlements/keys';
import { LaparError } from '../data/types';
import { ErrorState, LimitBadge, ProLocked, QtyStepper, Sheet } from './index';

afterEach(cleanup);

test('Sheet closes on Esc and backdrop, and is modal', () => {
  const onClose = vi.fn();
  render(
    <Sheet open onClose={onClose} title="Hello">
      <button>inside</button>
    </Sheet>,
  );
  expect(screen.getByRole('dialog', { name: 'Hello' }).getAttribute('aria-modal')).toBe('true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('QtyStepper respects min and max', () => {
  const onChange = vi.fn();
  render(<QtyStepper value={1} min={1} max={2} onChange={onChange} />);
  expect((screen.getByLabelText('Remove one') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Add one'));
  expect(onChange).toHaveBeenCalledWith(2);
});

test('LimitBadge shows used / limit and hides when unlimited', () => {
  const { container, rerender } = render(
    <EntitlementsProvider value={PLAN_DEFAULTS.basic}>
      <LimitBadge used={8} limitKey="max_tables" />
    </EntitlementsProvider>,
  );
  expect(container.textContent).toBe('8 / 15');
  rerender(
    <EntitlementsProvider value={PLAN_DEFAULTS.pro}>
      <LimitBadge used={8} limitKey="max_tables" />
    </EntitlementsProvider>,
  );
  expect(container.textContent).toBe('');
});

test('ProLocked opens the sheet with the demo call to action', () => {
  render(
    <ProCtaProvider value={{ kind: 'demo' }}>
      <ProLocked feature="combos" />
    </ProCtaProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Set meals/ }));
  expect(screen.getByText('Switch the plan to Pro to try it.')).toBeTruthy();
});

test('ErrorState maps the error code', () => {
  render(<ErrorState error={new LaparError('sold_out', 'x')} />);
  expect(screen.getByRole('alert').textContent).toContain('sold out');
});

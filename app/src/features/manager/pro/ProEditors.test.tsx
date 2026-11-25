import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { DataProvider } from '../../../data/context';
import { createDemoData } from '../../../data/demo';
import type { LaparData } from '../../../data/types';
import { EntitlementsProvider } from '../../../entitlements/hooks';
import { PLAN_DEFAULTS } from '../../../entitlements/keys';
import { ToastProvider } from '../../../ui';
import { ManagerView } from '../ManagerView';
import { addAfter, canRemove, moveColumn, type Col } from './columns';
import { ItemProFields } from './ItemProFields';

afterEach(cleanup);
const SHOP = 'shop-kopitiam-teras';

function setup(wrap?: (d: ReturnType<typeof createDemoData>) => LaparData) {
  const d = createDemoData({ persist: false });
  d.setPlan('pro');
  render(
    <DataProvider value={wrap ? wrap(d) : d}>
      <EntitlementsProvider value={PLAN_DEFAULTS.pro}>
        <ToastProvider>
          <ManagerView shopId={SHOP} />
        </ToastProvider>
      </EntitlementsProvider>
    </DataProvider>,
  );
  return d;
}

const open = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const col = (coreStatus: Col['coreStatus'], name = coreStatus): Col => ({ key: name, id: null, name, coreStatus });

test('column rules: the last column of a step stays; steps cannot go backwards', () => {
  const cols = [col('new'), col('preparing'), col('cooking'), col('ready')];
  expect(canRemove(cols, 1)).toBe(false);
  const more = addAfter(cols, 1, 'x');
  expect(more.map((c) => c.coreStatus)).toEqual(['new', 'preparing', 'preparing', 'cooking', 'ready']);
  expect(canRemove(more, 1)).toBe(true);
  expect(moveColumn(more, 2, -1)?.length).toBe(5); // same step swaps freely
  expect(moveColumn(cols, 1, -1)).toBeNull(); // preparing before new is out of order
});

test('column editor refuses to remove a status’s last column, and saves a new one', async () => {
  const d = setup();
  open(/Stations/);
  fireEvent.click(await screen.findByRole('button', { name: 'Columns for Kitchen' }));
  await screen.findByLabelText('Column 1 name');

  fireEvent.click(screen.getByRole('button', { name: 'Remove Cooking' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Every step needs at least one column');
  expect(screen.getAllByLabelText(/^Column \d name$/)).toHaveLength(4);

  fireEvent.click(screen.getByRole('button', { name: 'Add a column after Cooking' }));
  type('Column 4 name', 'Plating');
  fireEvent.click(screen.getByRole('button', { name: 'Save columns' }));
  const station = (await d.owner.getMenuEditor(SHOP)).stations[0]!;
  await waitFor(async () => expect((await d.pro.getBoardColumns(station.id)).map((c) => c.name)).toEqual(['New', 'Preparing', 'Cooking', 'Plating', 'Ready']));
});

test('promo: validation first, then it saves (window may cross midnight)', async () => {
  const d = setup();
  open(/Promos/);
  fireEvent.click(await screen.findByRole('button', { name: 'Add promo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save promo' }));
  expect(await screen.findByText('Please enter a name.')).toBeTruthy();
  expect(screen.getByText('Enter a whole number from 1 to 100.')).toBeTruthy();
  expect(screen.getByText('Pick at least one dish.')).toBeTruthy();

  type('Promo name', 'Supper');
  type('Percent off (1 to 100)', '101');
  fireEvent.click(screen.getByRole('button', { name: 'Save promo' }));
  expect(await screen.findByText('Enter a whole number from 1 to 100.')).toBeTruthy();

  type('Percent off (1 to 100)', '15');
  type('From', '22:00');
  type('Until', '02:00');
  const dish = (await d.owner.getMenuEditor(SHOP)).items[0]!;
  fireEvent.click(screen.getByRole('checkbox', { name: dish.name }));
  fireEvent.click(screen.getByRole('button', { name: 'Save promo' }));
  await waitFor(async () => {
    const p = (await d.pro.listPromos(SHOP)).find((x) => x.name === 'Supper');
    expect(p).toMatchObject({ discountType: 'percent', discountValue: 15, startTime: '22:00', endTime: '02:00', itemIds: [dish.id] });
  });

  // an RM amount is typed as "0.50" and stored as sen
  fireEvent.click(await screen.findByRole('button', { name: 'Add promo' }));
  type('Promo name', 'Cheaper');
  fireEvent.click(screen.getByRole('radio', { name: 'RM off' }));
  type('Amount off each dish (RM)', '0.50');
  fireEvent.click(screen.getAllByRole('checkbox', { name: dish.name })[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Save promo' }));
  await waitFor(async () => expect((await d.pro.listPromos(SHOP)).find((x) => x.name === 'Cheaper')?.discountValue).toBe(50));
});

test('set contents saves through setComboComponents', async () => {
  const d = setup();
  const editor = await d.owner.getMenuEditor(SHOP);
  const combo = editor.items.find((i) => i.isCombo)!;
  const single = editor.items.find((i) => !i.isCombo && !editor.comboComponents.some((c) => c.comboItemId === combo.id && c.itemId === i.id))!;
  cleanup();
  render(
    <DataProvider value={d}>
      <EntitlementsProvider value={PLAN_DEFAULTS.pro}>
        <ToastProvider>
          <ItemProFields draft={{ id: combo.id, shopId: SHOP, categoryId: combo.categoryId, name: combo.name, priceSen: combo.priceSen, isCombo: true }} onDraftChange={() => undefined} editor={editor} />
        </ToastProvider>
      </EntitlementsProvider>
    </DataProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Set contents' }));
  const sheet = await screen.findByRole('dialog');
  fireEvent.change(within(sheet).getByLabelText('Add a dish'), { target: { value: single.id } });
  fireEvent.click(within(sheet).getByRole('group', { name: `${single.name} quantity` }).querySelectorAll('button')[1]!);
  fireEvent.click(within(sheet).getByRole('button', { name: 'Save contents' }));
  await waitFor(async () => {
    const lines = (await d.owner.getMenuEditor(SHOP)).comboComponents.filter((c) => c.comboItemId === combo.id);
    expect(lines.some((l) => l.itemId === single.id)).toBe(true);
  });
});

test('takeaway: counter QR and a confirmed pickup link change', async () => {
  const d = setup();
  open(/Takeaway/);
  fireEvent.click(await screen.findByRole('button', { name: 'Show QR code for Counter' }));
  expect((await screen.findByRole('dialog')).querySelector('svg')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  const before = (await d.owner.getShopSettings(SHOP)).pickupBoardToken;
  fireEvent.click(await screen.findByRole('button', { name: 'Make a new link' }));
  expect(await screen.findByText(/stop working straight away/)).toBeTruthy();
  expect((await d.owner.getShopSettings(SHOP)).pickupBoardToken).toBe(before); // nothing changed yet
  fireEvent.click(screen.getByRole('button', { name: 'Yes, make a new link' }));
  await waitFor(async () => expect((await d.owner.getShopSettings(SHOP)).pickupBoardToken).not.toBe(before));
});

test('takeaway: a shop without a counter can create one', async () => {
  const saved: unknown[] = [];
  setup((d) => ({ ...d, owner: { ...d.owner, listTables: async (id: string) => (await d.owner.listTables(id)).filter((x) => x.kind !== 'counter'), saveTable: async (i) => (saved.push(i), d.owner.saveTable(i)) } }) as LaparData);
  open(/Takeaway/);
  fireEvent.click(await screen.findByRole('button', { name: 'Create counter' }));
  expect(await screen.findByText('Please enter a name.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Counter name'), { target: { value: 'Takeaway' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create counter' }));
  await waitFor(() => expect(saved).toEqual([{ shopId: SHOP, label: 'Takeaway', kind: 'counter' }]));
});

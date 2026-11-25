import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { DataProvider } from '../../data/context';
import { createDemoData } from '../../data/demo';
import { LaparError, type AdminApi, type AdminShopDTO, type LaparData } from '../../data/types';
import { PLAN_DEFAULTS } from '../../entitlements/keys';
import { AdminView } from './AdminView';

afterEach(cleanup);

const shop: AdminShopDTO = {
  id: 's1', name: 'Warung Ujian', slug: 'warung-ujian', planId: 'basic', active: true, createdAt: '2026-11-01T00:00:00Z', lastOrderAt: null,
  ownerEmails: ['o@lapar.test'], overrides: [], entitlements: PLAN_DEFAULTS.basic,
};

function setup(admin: Partial<AdminApi>) {
  const base = createDemoData({ persist: false });
  const api: AdminApi = {
    ...base.admin,
    listShops: async () => [shop],
    getPlatformSettings: async () => ({ whatsappNumber: null }),
    ...admin,
  };
  const data: LaparData = { ...base, admin: api };
  render(
    <DataProvider value={data}>
      <AdminView />
    </DataProvider>,
  );
}

test('create shop: slug is suggested, a taken slug is a readable error, success shows the one-time link', async () => {
  const createShop = vi.fn<AdminApi['createShop']>().mockRejectedValueOnce(new LaparError('slug_taken')).mockResolvedValue('s1');
  const createOwnerLink = vi.fn<AdminApi['createOwnerLink']>(async (_id, email, mode) => ({ email, mode, url: 'https://x.test/#/welcome?token_hash=abc&type=email', expiresHours: 24 }));
  setup({ createShop, createOwnerLink });
  fireEvent.change(await screen.findByLabelText('Shop name'), { target: { value: 'Warung Ujian' } });
  expect((screen.getByLabelText('Shop code') as HTMLInputElement).value).toBe('warung-ujian');
  fireEvent.change(screen.getByLabelText('Owner email'), { target: { value: 'new-owner@lapar.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create shop and owner link' }));
  expect(await screen.findByText('That shop code is already used. Pick another.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create shop and owner link' }));
  expect(await screen.findByText(/This link works once/)).toBeTruthy();
  expect(createOwnerLink).toHaveBeenCalledWith('s1', 'new-owner@lapar.test', 'invite');
  const wa = screen.getByRole('link', { name: 'Share on WhatsApp' }) as HTMLAnchorElement;
  expect(wa.href.startsWith('https://wa.me/?text=')).toBe(true);
  expect(decodeURIComponent(wa.href)).toContain('token_hash=abc&type=email');
});

test('override needs a note; deactivate asks for confirmation', async () => {
  const setOverride = vi.fn<AdminApi['setOverride']>(async () => undefined);
  const setShopActive = vi.fn<AdminApi['setShopActive']>(async () => undefined);
  setup({ setOverride, setShopActive });
  fireEvent.click(await screen.findByRole('button', { name: /Warung Ujian/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Override bill_split' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('A note is required.')).toBeTruthy();
  expect(setOverride).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Bill split add-on' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(setOverride).toHaveBeenCalledWith({ shopId: 's1', key: 'bill_split', enabled: true, note: 'Bill split add-on' }));

  fireEvent.click(screen.getByRole('button', { name: 'Deactivate shop' }));
  expect(setShopActive).not.toHaveBeenCalled();
  await screen.findByText(/Nothing is deleted/);
  fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate shop' }).at(-1)!);
  await waitFor(() => expect(setShopActive).toHaveBeenCalledWith('s1', false));
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DataProvider } from '../../data/context';
import { createDemoData } from '../../data/demo';
import { LaparError, type AuthApi, type AuthUser, type LaparData, type OwnerShopDTO, type StaffSession } from '../../data/types';
import { ManagerGate } from '../manager/ManagerGate';
import { StaffGate } from '../staff/StaffGate';
import { WelcomeView } from './WelcomeView';

const SHOP = 'shop-kopitiam-teras';
const shop: OwnerShopDTO = { id: SHOP, name: 'Kopitiam Teras', slug: 'kopitiam', active: true, planId: 'basic' };
const session: StaffSession = { shopId: SHOP, shopName: 'Kopitiam Teras', shopSlug: 'kopitiam', staffId: 's1', staffName: 'Ravi', expiresAt: new Date(Date.now() + 3600_000).toISOString(), pickupBoardToken: null };
const owner: AuthUser = { id: 'u1', email: 'o@example.test', isAnonymous: false };

/** Demo data with a scripted auth API: the sign-in logic is what these tests exercise. */
function fake(auth: Partial<AuthApi>): LaparData {
  const base = createDemoData({ persist: false });
  return { ...base, auth: { ...base.auth, getUser: async () => null, getStaffSession: async () => null, myShops: async () => [], ...auth } };
}
const renderWith = (d: LaparData, ui: React.ReactNode) => render(<DataProvider value={d}>{ui}</DataProvider>);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

test('PIN path: shop code and PIN claim a session and open the staff screens', async () => {
  let claimed: StaffSession | null = null;
  const claim = vi.fn<AuthApi['claimStaffSession']>(async () => (claimed = session));
  renderWith(fake({ getUser: async () => ({ id: 'a', email: null, isAnonymous: true }), getStaffSession: async () => claimed, claimStaffSession: claim }), <StaffGate />);
  fireEvent.change(await screen.findByLabelText('Shop code'), { target: { value: 'Kopitiam' } });
  for (const d of '1234') fireEvent.click(screen.getByRole('button', { name: d }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('tab', { name: /Orders/ })).toBeTruthy();
  expect(claim).toHaveBeenCalledWith('kopitiam', '1234');
  expect(screen.getByText('Signed in as Ravi')).toBeTruthy();
});

test('PIN path: an expired or forbidden session shows the PIN form', async () => {
  renderWith(fake({ getStaffSession: async () => Promise.reject(new LaparError('forbidden')) }), <StaffGate />);
  expect(await screen.findByLabelText('Shop code')).toBeTruthy();
});

test('owner path: wrong password shows an error, then sign in opens the manager', async () => {
  let signedIn = false;
  const signIn = vi.fn(async (_e: string, p: string) => {
    if (p !== 'correct-horse') throw new LaparError('not_signed_in');
    signedIn = true;
  });
  renderWith(fake({ getUser: async () => (signedIn ? owner : null), myShops: async () => [shop], signInWithPassword: signIn, getStaffSession: async () => session }), <ManagerGate />);
  expect(await screen.findByText(/signed in as staff/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'o@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('That email or password is not right.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('button', { name: 'Today' })).toBeTruthy();
});

test('owner path: an account with no shop says so; several shops show a picker', async () => {
  renderWith(fake({ getUser: async () => owner }), <ManagerGate />);
  expect(await screen.findByText(/No shop is linked to this account/)).toBeTruthy();
  cleanup();
  renderWith(fake({ getUser: async () => owner, myShops: async () => [shop, { ...shop, id: 'b', name: 'Second Shop' }] }), <ManagerGate />);
  fireEvent.click(await screen.findByRole('button', { name: 'Second Shop' }));
  expect(await screen.findByRole('button', { name: 'Switch shop' })).toBeTruthy();
});

test('owner on the staff screens skips the PIN', async () => {
  renderWith(fake({ getUser: async () => owner, myShops: async () => [shop] }), <StaffGate />);
  expect(await screen.findByRole('tab', { name: /Orders/ })).toBeTruthy();
});

test('welcome link: verifies, then needs a matching password of 8+ characters', async () => {
  const verify = vi.fn(async () => undefined);
  const setPassword = vi.fn(async () => undefined);
  const done = vi.fn();
  renderWith(fake({ verifyLink: verify, setPassword }), <WelcomeView tokenHash="h1" type="email" onDone={done} />);
  fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'short' } });
  fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'short' } });
  fireEvent.click(screen.getByRole('button', { name: /Save password/ }));
  expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-enough-1' } });
  fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'different-1' } });
  fireEvent.click(screen.getByRole('button', { name: /Save password/ }));
  expect(await screen.findByText('The two passwords are not the same.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'long-enough-1' } });
  fireEvent.click(screen.getByRole('button', { name: /Save password/ }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(verify).toHaveBeenCalledWith('h1', 'email');
  expect(setPassword).toHaveBeenCalledWith('long-enough-1');
});

test('welcome link: expired, used or malformed links show the new-link message', async () => {
  renderWith(fake({ verifyLink: async () => Promise.reject(new LaparError('forbidden')) }), <WelcomeView tokenHash="h2" type="recovery" onDone={() => undefined} />);
  expect(await screen.findByText('This link has expired or was already used. Ask Teras for a new one.')).toBeTruthy();
  cleanup();
  renderWith(fake({}), <WelcomeView tokenHash={null} type="bogus" onDone={() => undefined} />);
  expect(await screen.findByText(/Ask Teras for a new one/)).toBeTruthy();
});

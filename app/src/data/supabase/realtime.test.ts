import { expect, test, vi } from 'vitest';

type Cb = (status: string) => void;
function fakeChannel() {
  const ch = {
    handlers: [] as ((p: unknown) => void)[],
    cb: undefined as Cb | undefined,
    on: vi.fn((_t: string, _f: unknown, h: (p: unknown) => void) => (ch.handlers.push(h), ch)),
    subscribe: vi.fn((cb: Cb) => ((ch.cb = cb), ch)),
  };
  return ch;
}
const channels: ReturnType<typeof fakeChannel>[] = [];
const client = {
  channel: vi.fn(() => channels[channels.push(fakeChannel()) - 1]),
  removeChannel: vi.fn(),
};
vi.mock('./client', () => ({ getClient: () => Promise.resolve(client) }));
const { subscribeShop } = await import('./realtime');
const tick = () => new Promise((r) => setTimeout(r));
const ch0 = () => channels[0]!;

test('subscribers share one channel, get state and changes, and the last one removes it', async () => {
  const a = { change: vi.fn(), state: vi.fn() };
  const b = { change: vi.fn(), state: vi.fn() };
  const offA = subscribeShop('s1', a.change, a.state);
  await tick();
  ch0().cb!('SUBSCRIBED');
  const offB = subscribeShop('s1', b.change, b.state);
  expect(b.state).toHaveBeenCalledWith('live'); // current state straight away
  expect(client.channel).toHaveBeenCalledTimes(1);
  expect(ch0().subscribe).toHaveBeenCalledTimes(1);

  ch0().handlers[0]!({ eventType: 'INSERT', new: { id: 'o1' } });
  expect(a.change).toHaveBeenCalledWith({ table: 'orders', event: 'INSERT', id: 'o1' });
  expect(b.change).toHaveBeenCalledTimes(1);
  ch0().cb!('CLOSED');
  expect(a.state).toHaveBeenLastCalledWith('offline');
  expect(b.state).toHaveBeenLastCalledWith('offline');

  offA();
  expect(client.removeChannel).not.toHaveBeenCalled();
  ch0().handlers[0]!({ eventType: 'UPDATE', new: { id: 'o1' } });
  expect(a.change).toHaveBeenCalledTimes(1); // removed listener stays quiet
  expect(b.change).toHaveBeenCalledTimes(2);
  offB();
  expect(client.removeChannel).toHaveBeenCalledTimes(1);

  // resubscribe after full teardown builds a fresh channel
  const c = subscribeShop('s1', vi.fn(), vi.fn());
  await tick();
  expect(client.channel).toHaveBeenCalledTimes(2);
  c();
  expect(client.removeChannel).toHaveBeenCalledTimes(2);
});

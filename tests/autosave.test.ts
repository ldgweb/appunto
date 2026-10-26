import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { AutoSave, type SaveStatus } from '../src/lib/autosave.ts';

beforeEach(() => mock.timers.reset());

/** Lets pending promise callbacks run (setImmediate is not mocked). */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness(write: () => Promise<void> = async () => {}) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const statuses: SaveStatus[] = [];
  let writes = 0;
  const autosave = new AutoSave(
    () => {
      writes++;
      return write();
    },
    (status) => statuses.push(status),
  );
  return { autosave, statuses, writes: () => writes };
}

test('nothing is saved before the board is loaded', async () => {
  const { autosave, writes } = harness();
  autosave.touch();
  mock.timers.tick(5000);
  await settle();
  assert.equal(writes(), 0);
});

test('changes are saved once, after a short pause', async () => {
  const { autosave, statuses, writes } = harness();
  autosave.start();
  autosave.touch();
  mock.timers.tick(100);
  autosave.touch();
  mock.timers.tick(399);
  await settle();
  assert.equal(writes(), 0);
  mock.timers.tick(1);
  await settle();
  assert.equal(writes(), 1);
  assert.equal(statuses.at(-1), 'saved');
});

test('a long burst of typing is saved along the way', async () => {
  const { autosave, writes } = harness();
  autosave.start();
  for (let elapsed = 0; elapsed <= 2000; elapsed += 100) {
    autosave.touch();
    mock.timers.tick(100);
    await settle();
  }
  assert.equal(writes(), 1);
});

test('a failed save is retried', async () => {
  let fail = true;
  const { autosave, statuses, writes } = harness(async () => {
    if (fail) throw new Error('disk full');
  });
  autosave.start();
  autosave.touch();
  mock.timers.tick(400);
  await settle();
  assert.equal(statuses.at(-1), 'failed');
  fail = false;
  mock.timers.tick(3000);
  await settle();
  assert.equal(writes(), 2);
  assert.equal(statuses.at(-1), 'saved');
});

test('one save at a time, and the newest change is saved last', async () => {
  let finish: () => void = () => {};
  const { autosave, writes } = harness(() => new Promise<void>((resolve) => (finish = resolve)));
  autosave.start();
  autosave.touch();
  const first = autosave.flush();
  autosave.touch();
  const second = autosave.flush();
  await settle();
  assert.equal(writes(), 1);
  finish();
  await first;
  await settle();
  assert.equal(writes(), 2);
  finish();
  await second;
});

test('a blocked board is never saved', async () => {
  const { autosave, statuses, writes } = harness();
  autosave.start();
  autosave.block();
  autosave.touch();
  await autosave.flush();
  mock.timers.tick(5000);
  await settle();
  assert.equal(writes(), 0);
  assert.deepEqual(statuses, ['blocked']);
});

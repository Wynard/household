import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataStore, fileKey, type Loaded } from './store';
import { MockAdapter } from './mock';
import { buildSeed } from './seed';
import { O } from '../domain/ops';
import type { BudgetFile, ItemsFile } from '../domain/schemas';
import { emptyFile } from '../domain/files';

function setup() {
  const adapter = new MockAdapter(() => buildSeed('2026-10-07'), { persist: false, latency: false });
  const qc = new QueryClient();
  const store = new DataStore(adapter, qc, () => 'ana@example.com');
  return { adapter, qc, store };
}
const qtyOf = (d: ItemsFile, id: string) => d.items.find((i) => i.id === id)!.quantity;

describe('DataStore', () => {
  it('writes ops and undoes them with the returned inverse', async () => {
    const { store, adapter } = setup();
    await store.ensure('items');
    const { inverse } = await store.commit([O.item.inc('eggs', 2)]);
    expect(qtyOf((await adapter.readJson<ItemsFile>('items')).data, 'eggs')).toBe(6);
    await store.commit(inverse);
    expect(qtyOf((await adapter.readJson<ItemsFile>('items')).data, 'eggs')).toBe(4);
  });

  it("re-applies our change on top of the partner's newer version instead of overwriting it", async () => {
    const { store, adapter } = setup();
    await store.ensure('items');
    // partner adds 6 eggs and renames milk after we loaded the file
    adapter.externalEdit('items', (d) => {
      const f = d as ItemsFile;
      f.items.find((i) => i.id === 'eggs')!.quantity += 6;
      f.items.find((i) => i.id === 'milk')!.name = 'Milk 3.5%';
      return f;
    });
    await store.commit([O.item.inc('eggs', 1)]);
    const saved = (await adapter.readJson<ItemsFile>('items')).data;
    expect(qtyOf(saved, 'eggs')).toBe(11); // 4 + 6 (theirs) + 1 (ours)
    expect(saved.items.find((i) => i.id === 'milk')!.name).toBe('Milk 3.5%');
    expect(saved.updatedBy).toBe('ana@example.com');
  });

  it('shows changes optimistically and rolls them back when the write fails', async () => {
    const { store, adapter, qc } = setup();
    await store.ensure('items');
    adapter.failNextWrite = 'items';
    const p = store.commit([O.item.inc('eggs', 3)]);
    expect(qtyOf(qc.getQueryData<Loaded<ItemsFile>>(fileKey('items'))!.data, 'eggs')).toBe(7);
    await expect(p).rejects.toThrow(/Couldn't save/);
    expect(qtyOf(qc.getQueryData<Loaded<ItemsFile>>(fileKey('items'))!.data, 'eggs')).toBe(4);
    expect(qtyOf((await adapter.readJson<ItemsFile>('items')).data, 'eggs')).toBe(4);
  });

  it('serialises rapid commits so both count', async () => {
    const { store, adapter } = setup();
    await store.ensure('items');
    await Promise.all([store.commit([O.item.inc('eggs', 1)]), store.commit([O.item.inc('eggs', 1)])]);
    expect(qtyOf((await adapter.readJson<ItemsFile>('items')).data, 'eggs')).toBe(6);
  });

  it('creates a missing year file from its init op (year rollover)', async () => {
    const { store, adapter } = setup();
    const loaded = await store.ensure('budget-2027');
    expect(loaded.version).toBeNull();
    const init = emptyFile('budget-2027', 'ana@example.com', { openingBalance: 123.45 }) as Record<
      string,
      unknown
    >;
    await store.commit([{ t: 'init', file: 'budget-2027', value: init }]);
    const saved = (await adapter.readJson<BudgetFile>('budget-2027')).data;
    expect(saved.openingBalance).toBe(123.45);
  });

  it('refuses to write data that would not validate', async () => {
    const { store } = setup();
    await store.ensure('items');
    await expect(store.commit([O.item.patch('eggs', { quantity: -1 })])).rejects.toThrow(/Refused to save/);
  });
});

describe('newer schema guard', () => {
  it('refuses to read or write a file saved by a newer app version', async () => {
    const { store, adapter } = setup();
    await store.ensure('items');
    adapter.externalEdit('items', (d) => ({ ...(d as object), schemaVersion: 99 }));
    await expect(store.commit([O.item.inc('eggs', 1)])).rejects.toThrow(/updated on another phone/);
    const raw = (await adapter.readJson<ItemsFile>('items')).data;
    expect(raw.schemaVersion).toBe(99);
    expect(qtyOf(raw, 'eggs')).toBe(4); // untouched
    await expect(store.load('items')).rejects.toMatchObject({ name: 'NewerVersionError' });
  });
});

describe('live sync', () => {
  it('re-reads only the files the other person changed', async () => {
    const { store, adapter, qc } = setup();
    await store.ensure('items');
    await store.ensure('shopping');
    expect(await store.syncChanges()).toEqual([]);
    adapter.externalEdit('items', (d) => {
      const f = d as ItemsFile;
      f.items.find((i) => i.id === 'eggs')!.quantity = 12;
      return f;
    });
    expect(await store.syncChanges()).toEqual(['items']);
    expect(qtyOf(qc.getQueryData<Loaded<ItemsFile>>(fileKey('items'))!.data, 'eggs')).toBe(12);
  });
});

describe('saving speed: per-file queues and combined writes', () => {
  /** A store whose adapter writes take a while and can be released by hand. */
  function slow() {
    const s = setup();
    const writes: string[] = [];
    const gates: (() => void)[] = [];
    const real = s.adapter.writeJson.bind(s.adapter);
    s.adapter.writeJson = async (name, data, v) => {
      writes.push(name);
      if (name === 'items') await new Promise<void>((r) => gates.push(r));
      return real(name, data, v);
    };
    const release = async () => {
      while (gates.length) gates.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { ...s, writes, release };
  }

  it('a budget save does not wait for stock changes still being written', async () => {
    const { store, adapter, release } = slow();
    await store.ensure('items');
    await store.ensure('budget-2026');
    const stock = store.commit([O.item.inc('eggs', 1)]);
    const before = (await adapter.readJson<BudgetFile>('budget-2026')).data.adjustments.length;
    await store.commit([
      O.budget('budget-2026').upsertAdjustment({
        id: 'adj-x',
        date: '2026-10-07',
        by: 'ana@example.com',
        amount: -1,
        reason: 'test',
      }),
    ]);
    // the budget is saved while the items write is still waiting
    expect((await adapter.readJson<BudgetFile>('budget-2026')).data.adjustments.length).toBe(before + 1);
    await release();
    await stock;
  });

  it('taps made while a file is being written go out together in one write, each with its own undo', async () => {
    const { store, adapter, writes, release } = slow();
    await store.ensure('items');
    const first = store.commit([O.item.inc('eggs', 1)]);
    await new Promise((r) => setTimeout(r, 0));
    const more = [1, 2, 3, 4].map(() => store.commit([O.item.inc('eggs', 1)]));
    // the screen already shows all five
    expect(qtyOf(store.cached('items')!.data, 'eggs')).toBe(9);
    await release();
    await first;
    await release();
    const results = await Promise.all(more);
    expect(writes.filter((w) => w === 'items')).toHaveLength(2);
    expect(qtyOf((await adapter.readJson<ItemsFile>('items')).data, 'eggs')).toBe(9);
    // undoing one tap takes away exactly one egg
    const undo = store.commit(results[2].inverse);
    await release();
    await undo;
    expect(qtyOf((await adapter.readJson<ItemsFile>('items')).data, 'eggs')).toBe(8);
  });

  it('a failed write rolls back only its own file', async () => {
    const { store, adapter } = setup();
    await store.ensure('items');
    await store.ensure('shopping');
    adapter.failNextWrite = 'shopping';
    await expect(
      store.commit([O.item.inc('eggs', 1), O.shop.remove(store.cached('shopping')!.data.items[0].id)]),
    ).rejects.toThrow(/Couldn't save/);
    expect(qtyOf((await adapter.readJson<ItemsFile>('items')).data, 'eggs')).toBe(5);
    expect(store.cached('shopping')!.data.items).toHaveLength(
      (await adapter.readJson<{ items: unknown[] }>('shopping')).data.items.length,
    );
  });
});

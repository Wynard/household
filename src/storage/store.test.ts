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
    await expect(store.commit([O.item.patch('eggs', { unit: 'bananas' as never })])).rejects.toThrow(
      /Refused to save/,
    );
  });
});

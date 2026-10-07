// File format migrations (pure, idempotent). v1 -> v2: item tracking.
type Raw = Record<string, unknown>;

/**
 * items: every v1 item had an exact quantity, so it becomes an "amount" item.
 * Its status is derived from quantity vs threshold, and it keeps today's
 * shopping behaviour: added when below its threshold, or never without one.
 * Other files only change version (usage entries may now be status events).
 */
export function migrateV1toV2(raw: Raw, file: string): Raw {
  if (file !== 'items' || !Array.isArray(raw.items)) return { ...raw, schemaVersion: 2 };
  const items = (raw.items as Raw[]).map((it) => {
    if (it.tracking) return it; // already migrated
    const q = typeof it.quantity === 'number' ? it.quantity : 0;
    const low = typeof it.lowThreshold === 'number' && it.lowThreshold > 0 ? it.lowThreshold : 0;
    return {
      ...it,
      tracking: 'amount',
      status: q <= 0 ? 'out' : low && q < low ? 'low' : 'have',
      addToListWhen: low ? 'low' : 'never',
      subcategory: typeof it.subcategory === 'string' ? it.subcategory : '',
    };
  });
  return { ...raw, items, schemaVersion: 2 };
}

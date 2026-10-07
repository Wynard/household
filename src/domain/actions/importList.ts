import { z } from 'zod';
import { defineAction } from './types';
import { O, type Op } from '../ops';
import { planImport, type ParsedSection } from '../listImport';
import { lowStockSync } from '../stock';
import { plural } from '../format';
import type { Item } from '../schemas';

/**
 * Settings › Items › Import a list (5.2): creates the sections as categories
 * (no subcategories), any new storage places, and one simple item per line.
 * Names already in the household are skipped, so importing again only adds
 * new items.
 */
export const importList = defineAction({
  name: 'importList',
  input: z.object({
    sections: z.array(
      z.object({
        heading: z.string(),
        category: z.string().trim().min(1),
        items: z.array(z.object({ name: z.string().trim().min(1), have: z.boolean() })),
      }),
    ),
    /** section (category) -> storage place, overriding the defaults */
    places: z.record(z.string().trim().min(1)).default({}),
    /** put the items we don't have on the shopping list */
    addMissingToList: z.boolean().default(true),
  }),
  plan(ctx, input) {
    const h = ctx.snap.household;
    const p = planImport(input.sections as ParsedSection[], ctx.snap.items.items, h, input.places);
    if (!p.rows.length)
      return {
        title: 'Import the list',
        lines: [],
        ops: [],
        blocked: p.existing.length
          ? 'Everything on this list is already in your items.'
          : 'No items found. Each item needs a line like "- [x] Name" or "- [ ] Name".',
      };
    const ops: Op[] = [];
    for (const place of p.newPlaces) ops.push(O.household.listAdd('places', place));
    for (const c of p.newCategories) ops.push(O.household.catAdd(c, []));
    const placeOf = new Map(p.sections.map((s) => [s.category, s.place]));
    const created: Item[] = p.rows.map((r) => ({
      id: ctx.newId(),
      name: r.name,
      category: r.category,
      subcategory: '',
      categorySource: 'manual',
      place: placeOf.get(r.category) ?? 'Pantry',
      showInStock: true,
      tracking: 'simple',
      status: r.have ? 'have' : 'out',
      addToListWhen: 'out',
      unit: 'pcs',
      quantity: 0,
      aliases: [],
    }));
    for (const it of created) ops.push(O.item.upsert(it));
    const missing = created.filter((i) => i.status === 'out');
    if (input.addMissingToList)
      ops.push(
        ...lowStockSync(
          missing,
          missing.map((i) => i.id),
          ctx.snap.shopping.items,
          ctx,
        ),
      );
    const lines = [
      `${plural(created.length, 'item')} in ${plural(new Set(p.rows.map((r) => r.category)).size, 'section')}`,
      ...(p.newCategories.length ? [`New categories: ${p.newCategories.join(', ')}`] : []),
      ...(p.newPlaces.length ? [`New places: ${p.newPlaces.join(', ')}`] : []),
      ...(p.renamed.length ? [`Renamed to keep apart: ${p.renamed.map((r) => r.name).join(', ')}`] : []),
      ...(p.existing.length ? [`${plural(p.existing.length, 'item')} already there, skipped`] : []),
      ...(input.addMissingToList && missing.length
        ? [`${plural(missing.length, 'item')} we don't have added to the shopping list`]
        : []),
    ];
    return { title: `Import ${plural(created.length, 'item')}`, lines, ops, result: created.length };
  },
});

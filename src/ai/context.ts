// Compact summaries sent to Gemini: only what a request needs (2b, 4.5).
import type { CategoryTree, Item } from '../domain/schemas';

/** "id | name | aliases | unit", one per line; hidden items included (they still match receipts). */
export function catalogForPrompt(items: Item[], limit = 400): string {
  return items
    .filter((i) => !i.archived)
    .slice(0, limit)
    .map((i) => `${i.id} | ${i.name} | ${i.aliases.slice(0, 4).join('; ')} | ${i.unit}`)
    .join('\n');
}

export function treeForPrompt(tree: CategoryTree): string {
  return tree.map((c) => `${c.name}: ${c.subcategories.join(', ')}`).join('\n');
}

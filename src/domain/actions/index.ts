// The actions layer (4.6). Every change to data — from a button or from the
// Assistant — goes through one of these. Add new actions to ACTIONS.
import type { ActionDef } from './types';
import { adjustStock, setItemStatus } from './stock';
import { importList } from './importList';
import { addCategory, addSubcategory, deleteItem, mergeItems, moveItems, upsertItem } from './items';
import {
  addRecipeCategory,
  cookRecipe,
  deleteRecipe,
  setRecipeCategories,
  toggleFavourite,
  upsertRecipe,
} from './recipes';
import {
  addToShoppingList,
  checkShoppingItems,
  removeShoppingItems,
  stockFromShopping,
  updateShoppingItem,
} from './shopping';
import { removePlanEntry, setPlanEntries } from './plan';
import {
  addContribution,
  addPurchase,
  adjustPot,
  deleteAdjustment,
  deleteContribution,
  deletePurchase,
  restoreDeleted,
  updateContribution,
  updatePurchase,
} from './budget';
import {
  addPlace,
  addStore,
  deleteCategory,
  deletePlace,
  deleteRecipeCategory,
  deleteStore,
  deleteSubcategory,
  movePlace,
  renameCategory,
  renamePlace,
  renameRecipeCategory,
  renameStore,
  renameSubcategory,
  setMonthlyTarget,
  updateMember,
  restoreBackup,
  joinAsMember,
} from './settings';

export const ACTIONS = {
  importList,
  setItemStatus,
  addPurchase,
  updatePurchase,
  deletePurchase,
  addContribution,
  updateContribution,
  deleteContribution,
  adjustPot,
  deleteAdjustment,
  restoreDeleted,
  addPlace,
  renamePlace,
  deletePlace,
  movePlace,
  renameCategory,
  deleteCategory,
  renameSubcategory,
  deleteSubcategory,
  renameRecipeCategory,
  deleteRecipeCategory,
  addStore,
  renameStore,
  deleteStore,
  setMonthlyTarget,
  updateMember,
  restoreBackup,
  joinAsMember,
  setPlanEntries,
  removePlanEntry,
  toggleFavourite,
  setRecipeCategories,
  addRecipeCategory,
  upsertRecipe,
  deleteRecipe,
  cookRecipe,
  addToShoppingList,
  checkShoppingItems,
  updateShoppingItem,
  removeShoppingItems,
  stockFromShopping,
  adjustStock,
  upsertItem,
  deleteItem,
  moveItems,
  mergeItems,
  addCategory,
  addSubcategory,
};
// every entry must be an action definition
const _check: Record<string, ActionDef<never, unknown>> = ACTIONS as unknown as Record<
  string,
  ActionDef<never, unknown>
>;
void _check;

export type ActionName = keyof typeof ACTIONS;
export type ActionInput<N extends ActionName> = Parameters<(typeof ACTIONS)[N]['plan']>[1];

export * from './types';
export * from './run';

import type { CategoryTree } from './schemas';

export const DEFAULT_CATEGORIES: CategoryTree = [
  { name: 'Produce', subcategories: ['Vegetables', 'Fruit', 'Herbs'] },
  { name: 'Dairy & eggs', subcategories: ['Milk', 'Cheese', 'Eggs', 'Butter & cream', 'Yogurt'] },
  { name: 'Meat & fish', subcategories: ['Poultry', 'Pork', 'Beef', 'Fish', 'Deli'] },
  { name: 'Bakery', subcategories: ['Bread', 'Pastries'] },
  {
    name: 'Pantry',
    subcategories: ['Pasta & rice', 'Flour & baking', 'Oils & sauces', 'Canned & jars', 'Spices'],
  },
  { name: 'Drinks', subcategories: ['Coffee & tea', 'Water', 'Juice & soda', 'Alcohol'] },
  { name: 'Snacks & sweets', subcategories: ['Sweets', 'Chips & nuts'] },
  { name: 'Frozen', subcategories: ['Frozen vegetables', 'Ice cream', 'Ready meals'] },
  { name: 'Household', subcategories: ['Cleaning', 'Laundry', 'Paper goods', 'Bags & foil'] },
  { name: 'Personal care', subcategories: ['Hygiene', 'Health'] },
];

export const DEFAULT_PLACES = [
  'Fridge',
  'Freezer',
  'Pantry',
  'Cleaning cupboard',
  'Bathroom',
  'Storage room',
];

export const DEFAULT_RECIPE_CATEGORIES = ['Romanian', 'Italian', 'Asian', 'Arabic', 'Breakfast', 'Desserts'];

export const DEFAULT_STORES = ['Lidl', 'Kaufland', 'Mega Image', 'Carrefour', 'Profi', 'Penny', 'Auchan'];

/** Member colours: cobalt for the first person, saffron for the second. */
export const MEMBER_COLORS = ['#1F4FA8', '#E8B030'];

/** Categories where purchased lines default to "don't add to stock". */
export const NON_FOOD_CATEGORIES = ['Household', 'Personal care'];

/** Stepper step per unit (6.1). */
/** Stepper step per built-in unit; own counting units (can, jar…) step by 1. */
export const STEP_BY_UNIT: Record<string, number> = { pcs: 1, g: 100, ml: 100, kg: 0.5, l: 0.5 };

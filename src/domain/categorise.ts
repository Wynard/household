// Automatic categorisation (5.1).
// Order: 1. known item (name or alias) -> 2. local keyword rules -> 3. Gemini
// (receipts/imports, handled elsewhere) -> 4. "Needs a category".
//
// Rules are tested against a normalised name: lower case, Romanian diacritics
// removed (ș -> s, ă -> a ...). So every pattern is written without diacritics
// and matches both "smântână" and "smantana". ORDER MATTERS: the first match
// wins, so specific rules come before general ones ("laundry detergent" must
// hit Laundry before Cleaning, "toothpaste" must not hit Pasta, "ice cream"
// must not hit Butter & cream, "wine vinegar" must not hit Alcohol...).
import type { CategoryTree, Item } from './schemas';

export function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%.,]+/g, ' ')
    .trim();
}

type Rule = [RegExp, string, string];

export const RULES: Rule[] = [
  // ---- Personal care (before Pantry: "toothpaste", "paste de dinti") ----
  [
    /tooth|dinti|dentifric|shampoo|sampon|deodor|antiperspir|shower gel|gel de dus|hand soap|sapun|razor|aparat de ras|lame de ras|periuta|cotton pad|dischete|absorbant|tampon|lotion|lotiune|crema de (fata|maini|corp)|body lotion|conditioner|balsam de par|hair/,
    'Personal care',
    'Hygiene',
  ],
  [
    /vitamin|paracetamol|ibuprofen|nurofen|aspirin|plaster|bandage|pansament|medicine|medicament|pastil|sirop de tuse|cough|antiseptic|termometru|thermometer/,
    'Personal care',
    'Health',
  ],

  // ---- Pets (before everything: "nisip tofu" is cat litter, not tofu) ----
  [/nisip|litter|asternut|hrana (pentru )?(pisic|caini)|cat food|dog food/, 'Household', 'Pets'],

  // ---- Household (laundry before cleaning: "laundry detergent", "detergent rufe") ----
  [
    /laundry|rufe|ariel|persil|fabric softener|softener|balsam (de )?rufe|lenor|perwoll|wash(ing)? powder|capsule de spalat/,
    'Household',
    'Laundry',
  ],
  [
    /trash bag|bin bag|garbage bag|\bsaci\b|\bsac\b|\bfoil\b|folie|cling|aluminiu|ziploc|pungi|bags?\b/,
    'Household',
    'Bags & foil',
  ],
  [
    /toilet|igienic|paper towel|prosoape|hartie|kitchen roll|napkin|servet|tissue|batist|light bulb|\bbec\b|becuri|batteri|baterii/,
    'Household',
    'Paper goods',
  ],
  [
    /dish|vase|clean|deterg|bleach|\bclor\b|domestos|\bcif\b|mr proper|degresant|spray|burete|sponge|soap|lavete|cloth|dezinfect|disinfect|geam|windows?\b|wc\b/,
    'Household',
    'Cleaning',
  ],

  // ---- Frozen (before Dairy: "ice cream" is not cream) ----
  [/ice cream|inghetat|gelato|sorbet/, 'Frozen', 'Ice cream'],
  [
    /(frozen|congelat|surgelat).*(pizza|meal|lasagna|lasagne)|(pizza|lasagna|lasagne|ready meal).*(frozen|congelat)|ready meal|frozen pizza|pizza/,
    'Frozen',
    'Ready meals',
  ],
  [/frozen|congelat|surgelat/, 'Frozen', 'Frozen vegetables'],

  // ---- Plant milks (before Pantry: "lapte ovaz" is milk, not oats) ----
  [
    /(lapte|bautura|drink|milk) (de |din )?(ovaz|soia|migdale|cocos|orez|oat|soy|almond|coconut|rice)|(oat|soy|almond|coconut|rice) (milk|drink)/,
    'Dairy & eggs',
    'Milk',
  ],

  // ---- Pantry items that would otherwise hit Drinks/Dairy/Produce ----
  [/vinegar|otet/, 'Pantry', 'Oils & sauces'],
  [
    /peanut butter|unt de arahide|tomato paste|pasta de rosii|bulion|passata|zacusca|\bjam\b|\bgem\b|dulceata|honey|\bmiere\b/,
    'Pantry',
    'Canned & jars',
  ],
  [/garlic powder|onion powder|praf de usturoi|black pepper|piper|boia|paprika/, 'Pantry', 'Spices'],

  // ---- Drinks (before Produce: "orange juice", "lemonade") ----
  [/coffee|cafea|espresso|capsule|nescafe|\btea\b|ceai/, 'Drinks', 'Coffee & tea'],
  [
    /juice|\bsuc\b|nectar|\bcola\b|\bsoda\b|coca cola|fanta|sprite|pepsi|lemonade|limonada|ice tea|energy drink|tonic/,
    'Drinks',
    'Juice & soda',
  ],
  [/\bwater\b|\bapa\b|mineral|plata|borsec|dorna|izvorul|aqua carpatica/, 'Drinks', 'Water'],
  [
    /beer|\bbere\b|wine|\bvin\b|vodka|\bgin\b|whisk|\brom\b|\brum\b|tuica|palinca|prosecco|cidru|cider|lichior|liqueur|ursus|timisoreana|ciuc|stella|heineken/,
    'Drinks',
    'Alcohol',
  ],

  // ---- Bakery (before Produce/Dairy: "garlic bread", "cheese croissant") ----
  [
    /croissant|cake|pastry|prajitur|cozonac|covrig|placint|muffin|donut|gogos|strudel|briose|\bpie\b|tarta|chec|eclair|ecler/,
    'Bakery',
    'Pastries',
  ],
  [/bread|paine|bagheta|baguette|chifl|lipie|toast|franzel|rolls?\b|tortilla|pita/, 'Bakery', 'Bread'],

  // ---- Snacks & sweets (before Dairy: "milk chocolate", "butter cookies") ----
  [
    /chocolate|ciocolat|biscuit|candy|bomboan|cookie|napolitan|wafer|jeleuri|gummy|halva|rahat|caramel|praline|baton/,
    'Snacks & sweets',
    'Sweets',
  ],
  [
    /chips|crisps|\bnuts\b|\bnuci\b|alune|arahide|almond|migdal|caju|cashew|crackers|popcorn|seminte|pretzel|covrigei|saratele|sticks/,
    'Snacks & sweets',
    'Chips & nuts',
  ],

  // ---- Pantry ----
  [
    /\bpasta\b|\bpaste\b|spaghet|penne|fusilli|farfalle|tagliatelle|macaroan|taitei|noodle|\brice\b|\borez\b|couscous|bulgur|quinoa|lasagna sheets|foi de lasagna/,
    'Pantry',
    'Pasta & rice',
  ],
  [
    /flour|faina|sugar|zahar|yeast|drojdie|baking|praf de copt|bicarbonat|vanil|cacao|cocoa|gris|semolina|malai|cornmeal|oats|ovaz|fulgi/,
    'Pantry',
    'Flour & baking',
  ],
  [
    /\boil\b|ulei|olive oil|sauce|\bsos\b|\bsoy\b|ketchup|mayo|maionez|mustar|mustard|pesto|dressing/,
    'Pantry',
    'Oils & sauces',
  ],
  [
    /chickpea|naut|beans|fasole|conserv|canned|\btin\b|olives|masline|lentil|linte|porumb dulce|sweetcorn|tuna can|ton conserva/,
    'Pantry',
    'Canned & jars',
  ],
  [
    /\bsalt\b|\bsare\b|cumin|chimen|cinnamon|scortisoara|oregano|spice|condiment|curry|turmeric|nutmeg|nucsoara|dafin|bay leaf|cardamom|ghimbir|ginger|cuisoare|cloves?\b(?! garlic)|stock cube|cub de supa|delikat|vegeta/,
    'Pantry',
    'Spices',
  ],

  // ---- Dairy & eggs (cheese before butter & cream: "cream cheese") ----
  [
    /cheese|telemea|cascaval|branza|mozzarella|parmesan|parmigiano|cheddar|feta|gouda|emmental|urda|cas\b|mascarpone|ricotta|halloumi|cottage/,
    'Dairy & eggs',
    'Cheese',
  ],
  [/yog|iaurt|kefir|sana|lapte batut|buttermilk|skyr/, 'Dairy & eggs', 'Yogurt'],
  [/milk|lapte/, 'Dairy & eggs', 'Milk'],
  [/butter|\bunt\b|sour cream|smantana|cream|frisca|margarin/, 'Dairy & eggs', 'Butter & cream'],
  [/\beggs?\b|\boua\b|\bou\b/, 'Dairy & eggs', 'Eggs'],

  // ---- Meat & fish (deli before the rest: "chicken ham", "pork sausage") ----
  [
    /\bham\b|sunca|salam|sausage|carnat|crenvurst|parizer|pastrama|prosciutto|chorizo|kaizer|bacon|slanina|mortadel|pate|pateu/,
    'Meat & fish',
    'Deli',
  ],
  [/chicken|\bpui\b|piept|pulp|aripi|turkey|curcan|duck|\brata\b/, 'Meat & fish', 'Poultry'],
  [/pork|porc|ceafa|cotlet|muschiulet/, 'Meat & fish', 'Pork'],
  [/beef|\bvita\b|mince|tocata|steak|antricot|vrabioara/, 'Meat & fish', 'Beef'],
  [
    /fish|peste|salmon|somon|tuna|\bton\b|\bcod\b|hake|merluciu|shrimp|creveti|sardin|macrou|pastrav|trout|scrumbie|hering/,
    'Meat & fish',
    'Fish',
  ],

  // ---- Produce (fruit before vegetables; herbs separate) ----
  [
    /apple|\bmere\b|\bmar\b|banan|orange|portocal|lemon|lamai|lime|grape|strugur|melon|pepene|\bpears?\b|\bpere\b|plum|prune|berr|capsun|cires|visin|kiwi|mango|ananas|pineapple|peach|piersic|caise|apricot|avocado|mandarin|clementin|grapefruit|rodie|pomegranate|smochin|\bfig/,
    'Produce',
    'Fruit',
  ],
  [
    /dill|marar|parsley|patrunjel|basil|busuioc|herb|leustean|lovage|coriand|cilantro|\bmint\b|menta|rosemary|rozmarin|thyme|cimbru|chives|arpagic|verdeturi/,
    'Produce',
    'Herbs',
  ],
  [
    /tomato|rosii|potato|cartof|onion|ceapa|garlic|usturoi|pepper|ardei|cucumber|castrav|carrot|morcov|lettuce|salat|cabbage|varz|zucchini|dovlec|eggplant|vinete|aubergine|mushroom|ciuperc|spinach|spanac|broccoli|cauliflower|conopid|celery|telina|leek|praz|beetroot|sfecla|radish|ridich|\bcorn\b|porumb|\bpeas?\b|mazare|green beans|pastai|vegetable|legum|squash|pumpkin|dovleac|ginger root/,
    'Produce',
    'Vegetables',
  ],
];

export interface CategoryGuess {
  category: string;
  subcategory: string;
  /** 'known' = copied from a matching catalog item; 'rule' = keyword rule */
  via: 'known' | 'rule';
  itemId?: string;
}

/** Exact match on name or any alias, after normalising. */
export function findKnownItem(name: string, items: Item[]): Item | undefined {
  const n = normalise(name);
  if (!n) return undefined;
  return items.find(
    (i) => !i.archived && (normalise(i.name) === n || i.aliases.some((a) => normalise(a) === n)),
  );
}

export function ruleCategory(name: string): { category: string; subcategory: string } | null {
  const n = normalise(name);
  if (!n) return null;
  for (const [re, category, subcategory] of RULES) if (re.test(n)) return { category, subcategory };
  return null;
}

// a category on its own (no subcategory) is fine: imported lists have none
const inTree = (tree: CategoryTree, c: string, s: string) =>
  tree.some((n) => n.name === c && (!s || n.subcategories.includes(s)));

/** Suggests a category for a new name, or null ("Needs a category"). */
export function categorise(name: string, items: Item[], tree: CategoryTree): CategoryGuess | null {
  const known = findKnownItem(name, items);
  if (known && inTree(tree, known.category, known.subcategory))
    return { category: known.category, subcategory: known.subcategory, via: 'known', itemId: known.id };
  const r = ruleCategory(name);
  // the user may have renamed or deleted a default category; only suggest what exists
  if (r && inTree(tree, r.category, r.subcategory)) return { ...r, via: 'rule' };
  return null;
}

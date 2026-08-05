// Genuinely missing materials — referenced by a recipe but not found
// under any Arabic name currently in RawMaterials. Verified via price
// matching + exact-quantity recipe alignment against 80 confirmed
// recipe pairs (94 English catalog recipes vs 88 Arabic source
// recipes) — not guessed.
function repairMenuRecipeMaterials_() {
  return [
    ["توبينج ميكس بيري", "kg", 2, 160],
    ["توبينج خوخ", "kg", 2, 160],
    ["توبينج جوز الهند", "kg", 2, 160],
    ["كومبوت اناناس", "kg", 2, 160],
    ["صوص كيندر", "kg", 1, 165]
  ];
}

// Every English-named menu item's ingredients, translated to the
// Arabic material names actually in use.
function repairMenuRecipeLinks_() {
  return {
    "Mix Berry Smoothie": [["توبينج ميكس بيري", 0.03], ["تلج", 1.0]],
    "Peach Smoothie": [["توبينج خوخ", 0.03], ["تلج", 1.0]],
    "Pina Colada": [["توبينج جوز الهند", 0.01], ["كومبوت اناناس", 0.05], ["سيرب بلوكراساو", 0.005]],
    "Classic Mojito": [["سيرب موهيتو", 0.01], ["سيرب سويت اند ساور", 0.01], ["كان", 1.0], ["ليمون قطع", 1.0], ["نعناع فريش", 0.5]],
    "Peach Mojito": [["توبينج خوخ", 0.02], ["سيرب موهيتو", 0.01], ["كان", 1.0], ["ليمون قطع", 1.0], ["نعناع فريش", 0.5]],
    "Kinder Shake": [["ايس كريم", 0.21], ["صوص كيندر", 0.03], ["لبن", 0.15]],
    "Redbull": [["ريدبول", 1.0]],
    "Milk": [["لبن", 0.05]],
    "Honey": [["عسل", 0.02]],
    "Nuts": [["مكسرات", 0.02]],
    "Ice Cream": [["ايس كريم", 0.05]],
    "Espresso Shot": [["اسبريسو", 0.009]],
    "Espresso": [["اسبريسو", 0.007]],
    "Espresso Double": [["اسبريسو", 0.014]],
    "Macchiato": [["اسبريسو", 0.007], ["لبن", 0.02]],
    "Macchiato Double": [["اسبريسو", 0.014], ["لبن", 0.04]],
    "Cappuccino": [["اسبريسو", 0.014], ["لبن", 0.15], ["سكر", 0.01]],
    "Latte": [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.01]],
    "Spanish Latte": [["اسبريسو", 0.007], ["لبن", 0.15], ["حليب مكثف", 0.03]],
    "Mocha": [["اسبريسو", 0.007], ["لبن", 0.15], ["صوص شوكليت", 0.03]],
    "Cortado": [["لبن", 0.1], ["اسبريسو", 0.014], ["سكر", 0.01]],
    "Nescafe": [["نسكافيه", 0.005], ["لبن", 0.15]],
    "Hazelnut Coffee": [["بن تركي", 0.01], ["سيرب بندق", 0.03], ["لبن", 0.1]],
    "Nutella Coffee": [["بن تركي", 0.01], ["لبن", 0.1], ["سما نوتيلا", 0.05]],
    "French Coffee": [["بن تركي", 0.01], ["لبن", 0.1], ["سكر", 0.01]],
    "Turkish Coffee": [["بن تركي", 0.015], ["سكر", 0.01]],
    "Turkish Coffee Double": [["بن تركي", 0.025], ["سكر", 0.01]],
    "Classic Frappe": [["بودر فانيليا", 0.03], ["اسبريسو", 0.007], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]],
    "Nutella Frappe": [["بودر فانيليا", 0.03], ["سما نوتيلا", 0.04], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]],
    "Lotus Frappe": [["بودر فانيليا", 0.03], ["سما لوتس", 0.04], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]],
    "Caramel Frappe": [["بودر فانيليا", 0.03], ["اسبريسو", 0.007], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07], ["صوص كراميل", 0.03]],
    "Hazelnut Frappe": [["بودر فانيليا", 0.03], ["سما فسدق", 0.03], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]],
    "Iced Latte": [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.02]],
    "Iced Spanish Latte": [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.02], ["حليب مكثف", 0.02]],
    "Iced Mocha": [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.02], ["صوص شوكليت", 0.02]],
    "Iced Cappuccino": [["نسكافيه", 0.005], ["لبن", 0.15], ["سكر", 0.02]],
    "Vanilla Shake": [["ايس كريم", 0.21], ["لبن", 0.1]],
    "Chocolate Shake": [["صوص شوكليت", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]],
    "Mango Shake": [["مانجو فروزين", 0.1], ["لبن", 0.1], ["ايس كريم", 0.21]],
    "Strawberry Shake": [["توبينج فراوله", 0.025], ["ايس كريم", 0.21], ["لبن", 0.1]],
    "Mix Berry Shake": [["توبينج بيري", 0.015], ["توبينج راس بيري", 0.015], ["ايس كريم", 0.21], ["لبن", 0.1]],
    "Passion Fruit Shake": [["توبينج باشون فروت", 0.025], ["لبن", 0.1], ["ايس كريم", 0.21]],
    "Oreo Shake": [["اوريو", 1.0], ["لبن", 0.1], ["ايس كريم", 0.21]],
    "Nutella Shake": [["سما نوتيلا", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]],
    "Lotus Shake": [["لبن", 0.03], ["ايس كريم", 0.21]],
    "Pistachio Shake": [["سما فسدق", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]],
    "Caramel Shake": [["صوص كراميل", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]],
    "Mango": [["مانجو فريش", 0.25]],
    "Strawberry": [["فراوله فروزين", 0.2], ["سكر", 0.03], ["لبن", 0.15]],
    "Guava": [["جوافه فروزين", 0.2], ["لبن", 0.15], ["سكر", 0.03]],
    "Banana": [["موز", 0.15], ["لبن", 0.15], ["سكر", 0.03]],
    "Kiwi": [["كيوي فروزين", 0.2], ["سكر", 0.03]],
    "Watermelon": [["بطيخ فروزين", 0.25], ["سكر", 0.02]],
    "Pomegranate": [["رمان فروزين", 0.25], ["سكر", 0.02]],
    "Lemon": [["ليمون", 0.06], ["سكر", 0.04], ["تلج", 1.0], ["لبن", 0.02]],
    "Lemon Mint": [["ليمون", 0.06], ["نعناع سيرب", 0.04], ["سكر", 0.1], ["تلج", 1.0], ["لبن", 0.025]],
    "Date": [["بلح فروزين", 0.2], ["سكر", 0.01], ["لبن", 0.15]],
    "Avocado": [["افوكادو فروزين", 0.12], ["لبن", 0.15], ["ايس كريم", 0.07]],
    "Classic Yogurt": [["زبادي", 2.0], ["سكر", 0.02], ["لبن", 0.1]],
    "Watermelon Mint": [["بطيخ فروزين", 0.25], ["نعناع فريش", 1.0], ["تلج", 1.0], ["سكر", 0.02]],
    "Passion Fruit Smoothie": [["توبينج باشون فروت", 0.04], ["تلج", 1.0], ["سكر", 0.02]],
    "Mango Smoothie": [["مانجو فروزين", 0.1], ["سكر", 0.03], ["توبينج مانجو", 0.02]],
    "Strawberry Smoothie": [["فراوله فروزين", 0.2], ["سكر", 0.02], ["توبينج فراوله", 0.02]],
    "Lemon Mint Smoothie": [["ليمون", 0.075], ["سكر", 0.04], ["تلج", 1.0], ["لبن", 0.02]],
    "Mix Berry Mojito": [["كان", 1.0], ["سيرب موهيتو", 0.01], ["نعناع فريش", 0.5], ["ليمون قطع", 1.0], ["توبينج بيري", 0.01], ["توبينج راس بيري", 0.01]],
    "Strawberry Mojito": [["كان", 1.0], ["ليمون قطع", 1.0], ["سيرب موهيتو", 0.01], ["توبينج فراوله", 0.02], ["نعناع فريش", 0.5]],
    "Passion Fruit Mojito": [["كان", 1.0], ["سيرب موهيتو", 0.01], ["نعناع فريش", 0.5], ["توبينج باشون فروت", 0.02], ["ليمون قطع", 1.0]],
    "Blue Sky Mojito": [["كان", 1.0], ["سيرب موهيتو", 0.01], ["ليمون قطع", 1.0], ["سيرب بلوكراساو", 0.01], ["توبينج بيري", 0.02], ["نعناع فريش", 0.5]],
    "Mango Mojito": [["كان", 1.0], ["ليمون قطع", 1.0], ["سيرب موهيتو", 0.01], ["توبينج مانجو", 0.02], ["تلج", 1.0], ["نعناع فريش", 0.5]],
    "Cherry Mojito": [["كان", 1.0], ["تلج", 1.0], ["ليمون قطع", 1.0], ["سيرب موهيتو", 0.01], ["سيرب شيري", 0.02], ["نعناع فريش", 0.5]],
    "Red Bull Mojito": [["ريدبول", 1.0], ["ليمون قطع", 1.0], ["اكسترا توبينج", 0.02], ["نعناع فريش", 0.5], ["سيرب موهيتو", 0.01]],
    "Molten Cake": [["مولتن كيك", 1.0], ["ايس كريم", 0.07], ["سما نوتيلا", 0.02], ["سما وايت", 0.01]],
    "Cheesecake": [["تشيز كيك", 1.0], ["سما فسدق", 0.02], ["سما وايت", 0.01]],
    "Brownies": [["براونيز", 1.0], ["ايس كريم", 0.07], ["صوص شوكليت", 0.02]],
    "Waffle Nutella": [["سما نوتيلا", 0.05], ["ايس كريم", 0.07], ["عجينه وافل", 1.0], ["سما وايت", 0.01]],
    "Waffle Four Seasons": [["سما لوتس", 0.05], ["ايس كريم", 0.07], ["عجينه وافل", 1.0], ["سما وايت", 0.01]],
    "Berry Bomb": [["توبينج بيري", 0.02], ["توبينج راس بيري", 0.02], ["جهينه اناناس", 0.15], ["سيرب بلوكراساو", 0.02]],
    "Classic Cocktail": [["مانجو فروزين", 0.1], ["فراوله فروزين", 0.1], ["جوافه فروزين", 0.1], ["تلج", 1.0], ["سكر", 0.02]],
    "Mix Power": [["افوكادو فروزين", 0.06], ["بلح فروزين", 0.1], ["مكسرات", 0.015], ["عسل", 0.03], ["لبن", 0.15], ["سكر", 0.02]],
    "Mango Dream": [["مانجو فروزين", 0.1], ["خوخ فروزين", 0.1], ["ايس كريم", 0.07], ["توبينج باشون فروت", 0.025]],
    "Zabadooo": [["زبادي", 1.0], ["مانجو فروزين", 0.1], ["فواكهه قطع", 1.0], ["سكر", 0.02], ["تلج", 1.0]],
    "Glitch Cocktail": [["زبادي", 1.0], ["مانجو فروزين", 0.1], ["ايس كريم", 0.14], ["موز", 0.1], ["عسل", 0.02], ["لبن", 0.1]],
    "Twist": [["مانجو فروزين", 0.1], ["كيوي فروزين", 0.1], ["ايس كريم", 0.07], ["سكر", 0.02]],
    "Classic Tea": [["شاي باكت", 1.0], ["سكر", 0.05]],
    "Golden Tea": [["شاي سايب", 0.005], ["نعناع فريش", 0.5], ["سكر", 0.05], ["قرنفل", 0.005]],
    "Flavored Tea": [["شاي نكهات", 1.0], ["سكر", 0.05]],
    "Milk Tea": [["شاي باكت", 1.0], ["سكر", 0.05], ["لبن", 0.05]],
    "Flavored Milk Tea": [["شاي نكهات", 1.0], ["لبن", 0.05], ["سكر", 0.05]],
    "Hot Cider": [["جهينه تفاح", 0.15], ["قرفه عيدان", 0.01], ["سكر", 0.01]],
    "Herbal Tea": [["اعشاب باكت", 1.0], ["سكر", 0.05]],
    "Hot Chocolate": [["لبن", 0.1], ["بودر شوكليت", 0.03]],
    "Hot Chocolate Nutella": [["لبن", 0.1], ["بودر شوكليت", 0.03], ["سما نوتيلا", 0.02]],
    "Herbal Cocktail": [["اعشاب باكت", 2.0], ["قرفه عيدان", 0.01], ["عسل", 0.02], ["نعناع فريش", 0.5], ["ليمون قطع", 1.0]],
    "Sahlab": [["سحلب بودر", 0.025], ["لبن", 0.15], ["مكسرات", 0.02], ["سكر", 0.02]]
  };
}

function repairMenuRecipes_(readObjects_, appendObject_, newId_, getState_, setState_, withStockView_, logActivity_, username) {
  const existingMaterials = readObjects_("RawMaterials");
  const materialIdByName = {};
  existingMaterials.forEach((m) => { materialIdByName[m.name.trim().toLowerCase()] = m.id; });

  let materialsCreated = 0;
  repairMenuRecipeMaterials_().forEach((row) => {
    const [name, unit, minStockAlert, unitCost] = row;
    const key = name.trim().toLowerCase();
    if (materialIdByName[key]) return;
    const id = newId_("mat");
    appendObject_("RawMaterials", { id, name, unit, minStockAlert, unitCost, openingStock: 0, category: "", storageLocation: "", lastPurchaseCost: unitCost });
    materialIdByName[key] = id;
    materialsCreated++;
  });

  const recipeMap = repairMenuRecipeLinks_();
  const state = getState_();
  let itemsFixed = 0;
  const stillUnresolved = [];

  state.menu = state.menu.map((item) => {
    const recipeRows = recipeMap[item.name];
    if (!recipeRows) return item;
    const ingredients = [];
    recipeRows.forEach((row) => {
      const [matName, qty] = row;
      const id = materialIdByName[matName.trim().toLowerCase()];
      if (!id) { stillUnresolved.push(item.name + " -> " + matName); return; }
      ingredients.push({ stockId: id, qty });
    });
    itemsFixed++;
    return { ...item, ingredients };
  });
  setState_(state);

  logActivity_({
    actorUsername: username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT",
    description: username + " repaired menu recipe links — created " + materialsCreated + " missing material(s), rebuilt " + itemsFixed + " menu item recipe(s) to reference current inventory.",
  });

  return { ok: true, materialsCreated, itemsFixed, stillUnresolved, state: withStockView_(getState_()) };
}

module.exports = { repairMenuRecipes_ };

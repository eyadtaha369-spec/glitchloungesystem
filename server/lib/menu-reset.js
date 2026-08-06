// Complete menu + recipe rebuild from the source recipe book and menu
// photos — see conversation for the full derivation (price matching +
// exact-quantity recipe alignment, cross-checked, not guessed). Units
// are explicitly kg/L/pcs only, matching the business's actual
// convention (never g/ml) — this is the fix for recipe quantities
// being mislabeled with the wrong unit.
function menuResetMaterials_() {
  return [
    ["زبادي", "kg", 1, 10],
    ["عسل", "kg", 1, 200],
    ["لبن", "L", 1, 43],
    ["سكر", "kg", 1, 30],
    ["تلج", "kg", 1, 0],
    ["توبينج فراوله", "kg", 1, 160],
    ["توبينج مانجو", "kg", 1, 160],
    ["توبينج بيري", "kg", 1, 160],
    ["توبينج راس بيري", "kg", 1, 160],
    ["توبينج باشون فروت", "kg", 1, 160],
    ["بودر فانيليا", "kg", 1, 180],
    ["صوص شوكليت", "kg", 1, 165],
    ["صوص كراميل", "kg", 1, 165],
    ["بودر شوكليت", "kg", 1, 260],
    ["اسبريسو", "kg", 1, 700],
    ["نعناع سيرب", "L", 1, 90],
    ["بن تركي", "kg", 1, 420],
    ["مانجو فريش", "kg", 1, 60],
    ["فراوله فريش", "kg", 1, 55],
    ["شاي باكت", "pcs", 1, 1.5],
    ["مكسرات", "kg", 1, 600],
    ["سما نوتيلا", "kg", 1, 160],
    ["سما وايت", "kg", 1, 170],
    ["سما فسدق", "kg", 1, 550],
    ["سما لوتس", "kg", 1, 160],
    ["حليب مكثف", "L", 1, 285],
    ["اوريو", "kg", 1, 15],
    ["جوافه فروزين", "kg", 1, 75],
    ["فراوله فروزين", "kg", 1, 80],
    ["كيوي فروزين", "kg", 1, 180],
    ["بلح فروزين", "kg", 1, 75],
    ["افوكادو فروزين", "kg", 1, 250],
    ["بطيخ فروزين", "kg", 1, 75],
    ["رمان فروزين", "kg", 1, 75],
    ["سيرب فانيليا", "L", 1, 180],
    ["سيرب بندق", "L", 1, 180],
    ["سيرب بلوكراساو", "L", 1, 180],
    ["ايس كريم", "kg", 1, 80],
    ["ريدبول", "pcs", 1, 53],
    ["كان", "pcs", 1, 12.5],
    ["مياه ص", "pcs", 1, 5],
    ["مياه ك", "pcs", 1, 8.5],
    ["مشروب شعير", "L", 1, 13],
    ["مولتن كيك", "kg", 1, 35],
    ["تشيز كيك", "kg", 1, 40],
    ["براونيز", "kg", 1, 30],
    ["سيرب موهيتو", "L", 1, 170],
    ["مانجو فروزين", "kg", 1, 125],
    ["خوخ فروزين", "kg", 1, 150],
    ["فواكهه قطع", "pcs", 1, 15],
    ["موز", "kg", 1, 35],
    ["ليمون", "kg", 1, 25],
    ["جهينه تفاح", "kg", 1, 30],
    ["جهينه اناناس", "kg", 1, 35],
    ["نعناع فريش", "kg", 1, 1],
    ["سيرب سويت اند ساور", "L", 1, 180],
    ["ليمون قطع", "pcs", 1, 0.5],
    ["سيرب شيري", "L", 1, 170],
    ["اكسترا توبينج", "kg", 1, 170],
    ["عجينه وافل", "kg", 1, 10],
    ["معسل فاخر", "kg", 1, 740],
    ["معسل دندش", "kg", 1, 550],
    ["معسل مزايا", "kg", 1, 710],
    ["نسكافيه", "kg", 1, 1200],
    ["شاي سايب", "kg", 1, 200],
    ["قرنفل", "kg", 1, 900],
    ["شاي اخضر", "kg", 1, 2],
    ["شاي نكهات", "kg", 1, 5],
    ["قرفه عيدان", "kg", 1, 300],
    ["اعشاب باكت", "pcs", 1, 2],
    ["سحلب بودر", "kg", 1, 130],
    ["توبينج جوز الهند", "kg", 1, 160],
    ["صوص كيندر", "kg", 1, 165],
    ["فيروز", "pcs", 1, 45],
    ["كومبوت اناناس", "kg", 1, 160]
  ];
}

function menuResetItems_() {
  return {
    "Espresso": { price: 35, category: "Coffee", ingredients: [["اسبريسو", 0.007]] },
    "Espresso Double": { price: 45, category: "Coffee", ingredients: [["اسبريسو", 0.014]] },
    "Macchiato": { price: 35, category: "Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.02]] },
    "Macchiato Double": { price: 50, category: "Coffee", ingredients: [["اسبريسو", 0.014], ["لبن", 0.04]] },
    "Cappuccino": { price: 60, category: "Coffee", ingredients: [["اسبريسو", 0.014], ["لبن", 0.15], ["سكر", 0.01]] },
    "Latte": { price: 60, category: "Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.01]] },
    "Spanish Latte": { price: 65, category: "Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["حليب مكثف", 0.03]] },
    "Mocha": { price: 60, category: "Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["صوص شوكليت", 0.03]] },
    "Cortado": { price: 50, category: "Coffee", ingredients: [["لبن", 0.1], ["اسبريسو", 0.014], ["سكر", 0.01]] },
    "Nescafe": { price: 60, category: "Coffee", ingredients: [["نسكافيه", 0.005], ["لبن", 0.15]] },
    "Hazelnut Coffee": { price: 60, category: "Coffee", ingredients: [["بن تركي", 0.01], ["سيرب بندق", 0.03], ["لبن", 0.1]] },
    "Nutella Coffee": { price: 65, category: "Coffee", ingredients: [["بن تركي", 0.01], ["لبن", 0.1], ["سما نوتيلا", 0.05]] },
    "French Coffee": { price: 45, category: "Coffee", ingredients: [["بن تركي", 0.01], ["لبن", 0.1], ["سكر", 0.01]] },
    "Turkish Coffee": { price: 30, category: "Coffee", ingredients: [["بن تركي", 0.015], ["سكر", 0.01]] },
    "Turkish Coffee Double": { price: 35, category: "Coffee", ingredients: [["بن تركي", 0.025], ["سكر", 0.01]] },
    "Classic Frappe": { price: 70, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["اسبريسو", 0.007], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Nutella Frappe": { price: 75, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["سما نوتيلا", 0.04], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Lotus Frappe": { price: 75, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["سما لوتس", 0.04], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Caramel Frappe": { price: 80, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["اسبريسو", 0.007], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07], ["صوص كراميل", 0.03]] },
    "Hazelnut Frappe": { price: 90, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["سما فسدق", 0.03], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Iced Latte": { price: 70, category: "Ice Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.02]] },
    "Iced Spanish Latte": { price: 75, category: "Ice Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.02], ["حليب مكثف", 0.02]] },
    "Iced Mocha": { price: 75, category: "Ice Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.02], ["صوص شوكليت", 0.02]] },
    "Iced Cappuccino": { price: 70, category: "Ice Coffee", ingredients: [["نسكافيه", 0.005], ["لبن", 0.15], ["سكر", 0.02]] },
    "Vanilla Shake": { price: 60, category: "Milkshake", ingredients: [["ايس كريم", 0.21], ["لبن", 0.1]] },
    "Chocolate Shake": { price: 65, category: "Milkshake", ingredients: [["صوص شوكليت", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Mango Shake": { price: 70, category: "Milkshake", ingredients: [["مانجو فروزين", 0.1], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Strawberry Shake": { price: 65, category: "Milkshake", ingredients: [["توبينج فراوله", 0.025], ["ايس كريم", 0.21], ["لبن", 0.1]] },
    "Mix Berry Shake": { price: 65, category: "Milkshake", ingredients: [["توبينج بيري", 0.015], ["توبينج راس بيري", 0.015], ["ايس كريم", 0.21], ["لبن", 0.1]] },
    "Passion Fruit Shake": { price: 65, category: "Milkshake", ingredients: [["توبينج باشون فروت", 0.025], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Oreo Shake": { price: 70, category: "Milkshake", ingredients: [["اوريو", 1.0], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Nutella Shake": { price: 75, category: "Milkshake", ingredients: [["سما نوتيلا", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Lotus Shake": { price: 75, category: "Milkshake", ingredients: [["لبن", 0.03], ["ايس كريم", 0.21]] },
    "Pistachio Shake": { price: 80, category: "Milkshake", ingredients: [["سما فسدق", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Caramel Shake": { price: 75, category: "Milkshake", ingredients: [["صوص كراميل", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Kinder Shake": { price: 75, category: "Milkshake", ingredients: [["لبن", 0.2], ["صوص كيندر", 0.03], ["تلج", 0.1]] },
    "Mango": { price: 65, category: "Fresh Juice", ingredients: [["مانجو فريش", 0.25]] },
    "Strawberry": { price: 60, category: "Fresh Juice", ingredients: [["فراوله فروزين", 0.2], ["سكر", 0.03], ["لبن", 0.15]] },
    "Guava": { price: 60, category: "Fresh Juice", ingredients: [["جوافه فروزين", 0.2], ["لبن", 0.15], ["سكر", 0.03]] },
    "Banana": { price: 60, category: "Fresh Juice", ingredients: [["موز", 0.15], ["لبن", 0.15], ["سكر", 0.03]] },
    "Kiwi": { price: 70, category: "Fresh Juice", ingredients: [["كيوي فروزين", 0.2], ["سكر", 0.03]] },
    "Watermelon": { price: 65, category: "Fresh Juice", ingredients: [["بطيخ فروزين", 0.25], ["سكر", 0.02]] },
    "Pomegranate": { price: 60, category: "Fresh Juice", ingredients: [["رمان فروزين", 0.25], ["سكر", 0.02]] },
    "Lemon": { price: 45, category: "Fresh Juice", ingredients: [["ليمون", 0.06], ["سكر", 0.04], ["تلج", 1.0], ["لبن", 0.02]] },
    "Lemon Mint": { price: 55, category: "Fresh Juice", ingredients: [["ليمون", 0.06], ["نعناع سيرب", 0.04], ["سكر", 0.1], ["تلج", 1.0], ["لبن", 0.025]] },
    "Date": { price: 70, category: "Fresh Juice", ingredients: [["بلح فروزين", 0.2], ["سكر", 0.01], ["لبن", 0.15]] },
    "Avocado": { price: 80, category: "Fresh Juice", ingredients: [["افوكادو فروزين", 0.12], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Classic Yogurt": { price: 60, category: "Fresh Juice", ingredients: [["زبادي", 2.0], ["سكر", 0.02], ["لبن", 0.1]] },
    "Watermelon Mint": { price: 70, category: "Frozen Fresh", ingredients: [["بطيخ فروزين", 0.25], ["نعناع فريش", 1.0], ["تلج", 1.0], ["سكر", 0.02]] },
    "Passion Fruit Smoothie": { price: 65, category: "Frozen Fresh", ingredients: [["توبينج باشون فروت", 0.04], ["تلج", 1.0], ["سكر", 0.02]] },
    "Mango Smoothie": { price: 70, category: "Frozen Fresh", ingredients: [["مانجو فروزين", 0.1], ["سكر", 0.03], ["توبينج مانجو", 0.02]] },
    "Strawberry Smoothie": { price: 70, category: "Frozen Fresh", ingredients: [["فراوله فروزين", 0.2], ["سكر", 0.02], ["توبينج فراوله", 0.02]] },
    "Lemon Mint Smoothie": { price: 60, category: "Frozen Fresh", ingredients: [["ليمون", 0.075], ["سكر", 0.04], ["تلج", 1.0], ["لبن", 0.02]] },
    "Mix Berry Smoothie": { price: 65, category: "Frozen Fresh", ingredients: [["توبينج بيري", 0.02], ["توبينج راس بيري", 0.02], ["جهينه اناناس", 0.15], ["سيرب بلوكراساو", 0.02]] },
    "Peach Smoothie": { price: 65, category: "Frozen Fresh", ingredients: [["خوخ فروزين", 0.15], ["تلج", 0.1]] },
    "Pina Colada": { price: 75, category: "Frozen Fresh", ingredients: [["توبينج جوز الهند", 0.02], ["كومبوت اناناس", 0.03], ["تلج", 0.1]] },
    "Classic Cocktail": { price: 70, category: "Cocktails", ingredients: [["مانجو فروزين", 0.1], ["فراوله فروزين", 0.1], ["جوافه فروزين", 0.1], ["تلج", 1.0], ["سكر", 0.02]] },
    "Mix Power": { price: 80, category: "Cocktails", ingredients: [["افوكادو فروزين", 0.06], ["بلح فروزين", 0.1], ["مكسرات", 0.015], ["عسل", 0.03], ["لبن", 0.15], ["سكر", 0.02]] },
    "Mango Dream": { price: 75, category: "Cocktails", ingredients: [["مانجو فروزين", 0.1], ["خوخ فروزين", 0.1], ["ايس كريم", 0.07], ["توبينج باشون فروت", 0.025]] },
    "Berry Bomb": { price: 75, category: "Cocktails", ingredients: [["فراوله فروزين", 0.1], ["توبينج بيري", 0.02], ["توبينج راس بيري", 0.02], ["سكر", 0.02]] },
    "Zabadooo": { price: 75, category: "Cocktails", ingredients: [["زبادي", 1.0], ["مانجو فروزين", 0.1], ["فواكهه قطع", 1.0], ["سكر", 0.02], ["تلج", 1.0]] },
    "Twist": { price: 80, category: "Cocktails", ingredients: [["مانجو فروزين", 0.1], ["كيوي فروزين", 0.1], ["ايس كريم", 0.07], ["سكر", 0.02]] },
    "Glitch Cocktail": { price: 85, category: "Cocktails", ingredients: [["زبادي", 1.0], ["مانجو فروزين", 0.1], ["ايس كريم", 0.14], ["موز", 0.1], ["عسل", 0.02], ["لبن", 0.1]] },
    "Hot Chocolate": { price: 60, category: "Hot Drinks", ingredients: [["لبن", 0.1], ["بودر شوكليت", 0.03]] },
    "Hot Chocolate Nutella": { price: 70, category: "Hot Drinks", ingredients: [["لبن", 0.1], ["بودر شوكليت", 0.03], ["سما نوتيلا", 0.02]] },
    "Hot Cider": { price: 50, category: "Hot Drinks", ingredients: [["جهينه تفاح", 0.15], ["قرفه عيدان", 0.01], ["سكر", 0.01]] },
    "Classic Tea": { price: 25, category: "Hot Drinks", ingredients: [["شاي باكت", 1.0], ["سكر", 0.05]] },
    "Golden Tea": { price: 30, category: "Hot Drinks", ingredients: [["شاي سايب", 0.005], ["نعناع فريش", 0.5], ["سكر", 0.05], ["قرنفل", 0.005]] },
    "Milk Tea": { price: 35, category: "Hot Drinks", ingredients: [["شاي باكت", 1.0], ["سكر", 0.05], ["لبن", 0.05]] },
    "Flavored Tea": { price: 30, category: "Hot Drinks", ingredients: [["شاي نكهات", 1.0], ["سكر", 0.05]] },
    "Flavored Milk Tea": { price: 40, category: "Hot Drinks", ingredients: [["شاي نكهات", 1.0], ["لبن", 0.05], ["سكر", 0.05]] },
    "Herbal Tea": { price: 30, category: "Hot Drinks", ingredients: [["اعشاب باكت", 1.0], ["سكر", 0.05]] },
    "Herbal Cocktail": { price: 50, category: "Hot Drinks", ingredients: [["اعشاب باكت", 2.0], ["قرفه عيدان", 0.01], ["عسل", 0.02], ["نعناع فريش", 0.5], ["ليمون قطع", 1.0]] },
    "Molten Cake": { price: 70, category: "Desserts", ingredients: [["مولتن كيك", 1.0], ["ايس كريم", 0.07], ["سما نوتيلا", 0.02], ["سما وايت", 0.01]] },
    "Cheesecake": { price: 70, category: "Desserts", ingredients: [["تشيز كيك", 1.0], ["سما فسدق", 0.02], ["سما وايت", 0.01]] },
    "Brownies": { price: 65, category: "Desserts", ingredients: [["براونيز", 1.0], ["ايس كريم", 0.07], ["صوص شوكليت", 0.02]] },
    "Waffle Nutella": { price: 75, category: "Desserts", ingredients: [["سما نوتيلا", 0.05], ["ايس كريم", 0.07], ["عجينه وافل", 1.0], ["سما وايت", 0.01]] },
    "Waffle Four Seasons": { price: 85, category: "Desserts", ingredients: [["صوص شوكليت", 0.02], ["عجينه وافل", 1.0], ["ايس كريم", 0.07], ["سما نوتيلا", 0.03], ["سما وايت", 0.01]] },
    "Classic Mojito": { price: 60, category: "Mojito", ingredients: [["كان", 1], ["ليمون قطع", 1], ["نعناع فريش", 0.5], ["سيرب موهيتو", 0.01]] },
    "Mix Berry Mojito": { price: 65, category: "Mojito", ingredients: [["كان", 1.0], ["سيرب موهيتو", 0.01], ["نعناع فريش", 0.5], ["ليمون قطع", 1.0], ["توبينج بيري", 0.01], ["توبينج راس بيري", 0.01]] },
    "Strawberry Mojito": { price: 65, category: "Mojito", ingredients: [["كان", 1.0], ["ليمون قطع", 1.0], ["سيرب موهيتو", 0.01], ["توبينج فراوله", 0.02], ["نعناع فريش", 0.5]] },
    "Passion Fruit Mojito": { price: 70, category: "Mojito", ingredients: [["كان", 1.0], ["سيرب موهيتو", 0.01], ["نعناع فريش", 0.5], ["توبينج باشون فروت", 0.02], ["ليمون قطع", 1.0]] },
    "Blue Sky Mojito": { price: 75, category: "Mojito", ingredients: [["كان", 1.0], ["سيرب موهيتو", 0.01], ["ليمون قطع", 1.0], ["سيرب بلوكراساو", 0.01], ["توبينج بيري", 0.02], ["نعناع فريش", 0.5]] },
    "Mango Mojito": { price: 70, category: "Mojito", ingredients: [["كان", 1.0], ["ليمون قطع", 1.0], ["سيرب موهيتو", 0.01], ["توبينج مانجو", 0.02], ["تلج", 1.0], ["نعناع فريش", 0.5]] },
    "Cherry Mojito": { price: 70, category: "Mojito", ingredients: [["كان", 1.0], ["تلج", 1.0], ["ليمون قطع", 1.0], ["سيرب موهيتو", 0.01], ["سيرب شيري", 0.02], ["نعناع فريش", 0.5]] },
    "Peach Mojito": { price: 65, category: "Mojito", ingredients: [["كان", 1], ["ليمون قطع", 1], ["نعناع فريش", 0.5], ["سيرب موهيتو", 0.01], ["خوخ فروزين", 0.02]] },
    "Red Bull Mojito": { price: 90, category: "Mojito", ingredients: [["ريدبول", 1.0], ["ليمون قطع", 1.0], ["اكسترا توبينج", 0.02], ["نعناع فريش", 0.5], ["سيرب موهيتو", 0.01]] },
    "Water": { price: 10, category: "Soft Drinks", ingredients: [["مياه ص", 1]] },
    "Soft Soda": { price: 40, category: "Soft Drinks", ingredients: [["كان", 1]] },
    "Fayrouz": { price: 45, category: "Soft Drinks", ingredients: [["فيروز", 1]] },
    "Redbull": { price: 80, category: "Soft Drinks", ingredients: [["ريدبول", 1]] },
    "Milk": { price: 15, category: "Extras", ingredients: [["لبن", 0.1]] },
    "Honey": { price: 15, category: "Extras", ingredients: [["عسل", 0.02]] },
    "Nuts": { price: 20, category: "Extras", ingredients: [["مكسرات", 0.02]] },
    "Sauce": { price: 20, category: "Extras", ingredients: [["صوص شوكليت", 0.02]] },
    "Ice Cream": { price: 15, category: "Extras", ingredients: [["ايس كريم", 0.05]] },
    "Espresso Shot": { price: 20, category: "Extras", ingredients: [["اسبريسو", 0.007]] },
    "Maasel": { price: 20, category: "Shisha", ingredients: [["معسل مزايا", 0.02]] },
    "Moroccan": { price: 40, category: "Shisha", ingredients: [["معسل مزايا", 0.02]] },
    "Moroccan Flavors": { price: 45, category: "Shisha", ingredients: [["معسل فاخر", 0.02]] },
    "Premium Shisha": { price: 65, category: "Shisha", ingredients: [["معسل فاخر", 0.03]] },
    "Glitch Special Shisha": { price: 85, category: "Shisha", ingredients: [["معسل دندش", 0.03]] },
    "Extra Hose (Regular)": { price: 10, category: "Shisha", ingredients: [] },
    "Extra Hose (Ice)": { price: 20, category: "Shisha", ingredients: [] }
  };
}

function resetMenuAndRecipes_(readObjects_, appendObject_, updateObjectById_, newId_, getState_, setState_, withStockView_, username) {
  const existingMaterials = readObjects_("RawMaterials");
  const materialIdByName = {};
  existingMaterials.forEach((m) => { materialIdByName[m.name.trim().toLowerCase()] = m.id; });

  // Create any material referenced by the new recipes that doesn't
  // already exist by name — never duplicates, never touches materials
  // that already exist (their existing stock, cost, etc. are untouched).
  let materialsCreated = 0;
  menuResetMaterials_().forEach((row) => {
    const [name, unit, minStockAlert, unitCost] = row;
    const key = name.trim().toLowerCase();
    if (materialIdByName[key]) return;
    const id = newId_("mat");
    appendObject_("RawMaterials", { id, name, unit, minStockAlert, unitCost, openingStock: 0, category: "", storageLocation: "", lastPurchaseCost: unitCost });
    materialIdByName[key] = id;
    materialsCreated++;
  });

  // Wipe the entire menu and rebuild it fresh from source.
  const itemDefs = menuResetItems_();
  const state = getState_();
  const newMenu = [];
  const unresolved = [];
  Object.keys(itemDefs).forEach((name) => {
    const def = itemDefs[name];
    const ingredients = [];
    def.ingredients.forEach((row) => {
      const [matName, qty] = row;
      const id = materialIdByName[matName.trim().toLowerCase()];
      if (!id) { unresolved.push(name + " -> " + matName); return; }
      ingredients.push({ stockId: id, qty });
    });
    newMenu.push({ id: newId_("item"), name, price: def.price, category: def.category, ingredients });
  });
  state.menu = newMenu;
  setState_(state);

  return { ok: true, materialsCreated, itemsCreated: newMenu.length, unresolved, state: withStockView_(getState_()) };
}

module.exports = { resetMenuAndRecipes_ };

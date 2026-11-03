// Seed data, generated relative to today so promised dates always fall in the next five days.
//
// The story the data is built to tell: Moradabad Brass Collective is about to report a brass
// shortage. Its own orders are the obvious casualties, but Kaarigar Woodworks (wall shelves) and
// Khurja Clay House (table lamps) also use brass, and their orders never mention Moradabad.
// Cane is shared the same way between Moradabad and Channapatna. Channapatna (tier C) is
// already committed past its declared weekly capacity.
import { addDays, today } from "./dates";
import type { Order, Producer, Product } from "./types";

export const producers: Producer[] = [
  {
    id: "PR-01",
    name: "Kaarigar Woodworks",
    tier: "A",
    onTimeRate: 0.97,
    defectRate: 0.012,
    capacityVariance: 0.06,
    declaredWeeklyUnits: 120,
    materialsUsed: ["walnut", "mango wood", "brass"],
  },
  {
    id: "PR-02",
    name: "Moradabad Brass Collective",
    tier: "B",
    onTimeRate: 0.91,
    defectRate: 0.035,
    capacityVariance: 0.17,
    declaredWeeklyUnits: 80,
    materialsUsed: ["brass", "cane"],
  },
  {
    id: "PR-03",
    name: "Channapatna Cane & Craft",
    tier: "C",
    onTimeRate: 0.79,
    defectRate: 0.081,
    capacityVariance: 0.34,
    declaredWeeklyUnits: 40,
    materialsUsed: ["cane", "mango wood"],
  },
  {
    id: "PR-04",
    name: "Jaipur Hand Block Studio",
    tier: "A",
    onTimeRate: 0.96,
    defectRate: 0.015,
    capacityVariance: 0.08,
    declaredWeeklyUnits: 150,
    materialsUsed: ["cotton"],
  },
  {
    id: "PR-05",
    name: "Khurja Clay House",
    tier: "B",
    onTimeRate: 0.87,
    defectRate: 0.05,
    capacityVariance: 0.21,
    declaredWeeklyUnits: 60,
    materialsUsed: ["ceramic", "cotton", "brass"],
  },
];

export const products: Product[] = [
  { id: "P-01", name: "Walnut serving board", category: "Kitchen", materials: ["walnut"], basePriceEur: 48, dispatchDays: 3 },
  { id: "P-02", name: "Mango wood salad bowl", category: "Kitchen", materials: ["mango wood"], basePriceEur: 36, dispatchDays: 2 },
  { id: "P-03", name: "Brass candle holder, set of 3", category: "Decor", materials: ["brass"], basePriceEur: 42, dispatchDays: 3 },
  { id: "P-04", name: "Cane pendant shade", category: "Lighting", materials: ["cane", "brass"], basePriceEur: 95, dispatchDays: 5 },
  { id: "P-05", name: "Block-print cotton cushion cover", category: "Textiles", materials: ["cotton"], basePriceEur: 28, dispatchDays: 2 },
  { id: "P-06", name: "Ceramic table lamp, cotton shade", category: "Lighting", materials: ["ceramic", "cotton", "brass"], basePriceEur: 110, dispatchDays: 4 },
  { id: "P-07", name: "Walnut & brass wall shelf", category: "Furniture", materials: ["walnut", "brass"], basePriceEur: 120, dispatchDays: 5 },
  { id: "P-08", name: "Cane & mango wood tray", category: "Decor", materials: ["cane", "mango wood"], basePriceEur: 64, dispatchDays: 4 },
];

// [order number, product, producer, quantity, days from today until promised dispatch]
const ORDER_ROWS: [number, string, string, number, number][] = [
  [1041, "P-01", "PR-01", 12, 1],
  [1042, "P-03", "PR-02", 20, 0],
  [1043, "P-05", "PR-04", 30, 2],
  [1044, "P-08", "PR-03", 8, 3],
  [1045, "P-07", "PR-01", 6, 2],
  [1046, "P-04", "PR-02", 10, 4],
  [1047, "P-06", "PR-05", 8, 3],
  [1048, "P-02", "PR-01", 15, 0],
  [1049, "P-02", "PR-03", 10, 1],
  [1050, "P-05", "PR-04", 24, 4],
  [1051, "P-03", "PR-02", 16, 2],
  [1052, "P-01", "PR-01", 10, 3],
  [1053, "P-06", "PR-05", 6, 1],
  [1054, "P-08", "PR-03", 12, 4],
  [1055, "P-07", "PR-01", 4, 4],
  [1056, "P-04", "PR-02", 6, 1],
  [1057, "P-05", "PR-04", 18, 0],
  [1058, "P-02", "PR-03", 14, 2],
  [1059, "P-06", "PR-05", 10, 4],
  [1060, "P-01", "PR-01", 8, 1],
];

export function seedOrders(): Order[] {
  const now = today();
  return ORDER_ROWS.map(([num, productId, producerId, quantity, offset]) => {
    const product = products.find((p) => p.id === productId)!;
    const dispatch = addDays(now, offset);
    return {
      id: `SS-${num}`,
      productId,
      producerId,
      quantity,
      // Ordered exactly the product's dispatch window before the promised dispatch, mid-morning.
      orderedAt: new Date(`${addDays(dispatch, -product.dispatchDays)}T10:00:00`).toISOString(),
      promisedDispatchDate: dispatch,
      // Delivery takes 3–7 days; vary it deterministically by order number.
      promisedDeliveryDate: addDays(dispatch, 3 + (num % 5)),
      status: "OPEN",
      riskReason: null,
    };
  });
}

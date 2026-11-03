// In-memory store. Pages only talk to these async functions, so this module can be swapped for a
// Postgres-backed one later without touching them. Data resets when the server restarts.
import { producers as seedProducers, products as seedProducts, seedOrders } from "./seed";
import { OPEN_STATUSES, type Order, type OrderStatus, type Producer, type Product } from "./types";

type State = { producers: Producer[]; products: Product[]; orders: Order[] };

// Kept on globalThis so dev-mode hot reloads don't reseed.
const g = globalThis as unknown as { __supplierSignalStore?: State };

function state(): State {
  g.__supplierSignalStore ??= {
    producers: structuredClone(seedProducers),
    products: structuredClone(seedProducts),
    orders: seedOrders(),
  };
  return g.__supplierSignalStore;
}

// Callers get copies, so nothing outside this module can mutate the store by accident.
const copy = <T>(v: T): T => structuredClone(v);

export async function listProducers(): Promise<Producer[]> {
  return copy(state().producers);
}

export async function getProducer(id: string): Promise<Producer | null> {
  return copy(state().producers.find((p) => p.id === id) ?? null);
}

export async function listProducts(): Promise<Product[]> {
  return copy(state().products);
}

export async function getProduct(id: string): Promise<Product | null> {
  return copy(state().products.find((p) => p.id === id) ?? null);
}

export async function listOrders(filter: { status?: OrderStatus[]; producerId?: string } = {}): Promise<Order[]> {
  return copy(
    state()
      .orders.filter((o) => !filter.status || filter.status.includes(o.status))
      .filter((o) => !filter.producerId || o.producerId === filter.producerId)
      .sort((a, b) => a.promisedDispatchDate.localeCompare(b.promisedDispatchDate) || a.id.localeCompare(b.id)),
  );
}

export async function listOpenOrders(): Promise<Order[]> {
  return listOrders({ status: OPEN_STATUSES });
}

export async function getOrder(id: string): Promise<Order | null> {
  return copy(state().orders.find((o) => o.id === id) ?? null);
}

/** Units in open orders per producer id. Producers with nothing open are present with 0. */
export async function committedUnitsByProducer(): Promise<Record<string, number>> {
  const totals: Record<string, number> = Object.fromEntries(state().producers.map((p) => [p.id, 0]));
  for (const o of state().orders) {
    if (OPEN_STATUSES.includes(o.status)) totals[o.producerId] = (totals[o.producerId] ?? 0) + o.quantity;
  }
  return totals;
}

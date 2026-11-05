import { TierBadge, StatusBadge } from "@/components/Badges";
import { daysBetween, formatDate, TODAY } from "@/lib/dates";
import { listOpenOrders, listProducers, listProducts } from "@/lib/store";

// The store is mutable and the dates are relative to today, so never prerender this page.
export const dynamic = "force-dynamic";

function daysLabel(days: number) {
  if (days < 0) return { text: `${-days}d overdue`, className: "due-today" };
  if (days === 0) return { text: "Today", className: "due-today" };
  if (days === 1) return { text: "1 day", className: "due-soon" };
  return { text: `${days} days`, className: "" };
}

export default async function OpenOrdersPage() {
  const [orders, products, producers] = await Promise.all([listOpenOrders(), listProducts(), listProducers()]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const producerById = new Map(producers.map((p) => [p.id, p]));
  const now = TODAY;
  const units = orders.reduce((s, o) => s + o.quantity, 0);

  return (
    <>
      <h1>Open orders</h1>
      <p className="subtitle">
        {orders.length} orders · {units} units · sorted by promised dispatch
      </p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Product</th>
              <th>Producer</th>
              <th>Tier</th>
              <th className="num">Qty</th>
              <th>Promised dispatch</th>
              <th>Days left</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const product = productById.get(o.productId);
              const producer = producerById.get(o.producerId);
              const due = daysLabel(daysBetween(now, o.promisedDispatchDate));
              return (
                <tr key={o.id}>
                  <td className="mono nowrap">{o.id}</td>
                  <td>
                    {product?.name ?? o.productId}
                    {product && <div className="muted small">{product.materials.join(", ")}</div>}
                  </td>
                  <td>{producer?.name ?? o.producerId}</td>
                  <td>{producer && <TierBadge tier={producer.tier} short />}</td>
                  <td className="num">{o.quantity}</td>
                  <td className="nowrap">{formatDate(o.promisedDispatchDate)}</td>
                  <td className={`nowrap ${due.className}`}>{due.text}</td>
                  <td>
                    <StatusBadge status={o.status} />
                    {o.riskReason && <div className="muted small">{o.riskReason}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

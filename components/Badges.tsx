import type { OrderStatus, Tier } from "@/lib/types";

const TIER_LABELS: Record<Tier, string> = { A: "A · Trusted", B: "B · Monitored", C: "C · Verify" };

export function TierBadge({ tier, short = false }: { tier: Tier; short?: boolean }) {
  return <span className={`badge tier-${tier}`}>{short ? tier : TIER_LABELS[tier]}</span>;
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge status-${status}`}>{status.replace("_", " ")}</span>;
}

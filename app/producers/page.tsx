import { TierBadge } from "@/components/Badges";
import { committedUnitsByProducer, listProducers } from "@/lib/store";
import type { Producer, Tier } from "@/lib/types";

export const dynamic = "force-dynamic";

// Tier A thresholds from PROJECT.md; a signal outside them is highlighted.
const TIER_A = { onTimeRate: 0.95, defectRate: 0.02, capacityVariance: 0.1 };

const TIER_RULE: Record<Tier, string> = {
  A: "Self-reports applied automatically.",
  B: "Self-reports applied, flagged for review.",
  C: "Never auto-applied. Capped volume, no same-day promises.",
};

const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

function Signal({ label, value, off }: { label: string; value: string; off: boolean }) {
  return (
    <div className={`signal${off ? " off" : ""}`}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function ProducerCard({ p, committed }: { p: Producer; committed: number }) {
  const load = committed / p.declaredWeeklyUnits;
  const over = committed > p.declaredWeeklyUnits;
  return (
    <section className="card producer">
      <div className="producer-head">
        <div>
          <h2>{p.name}</h2>
          <div className="muted small mono">{p.id}</div>
        </div>
        <TierBadge tier={p.tier} />
      </div>
      <div className="signals">
        <Signal label="On-time" value={pct(p.onTimeRate)} off={p.onTimeRate < TIER_A.onTimeRate} />
        <Signal label="Defects" value={pct(p.defectRate)} off={p.defectRate >= TIER_A.defectRate} />
        <Signal
          label="Capacity variance"
          value={pct(p.capacityVariance)}
          off={p.capacityVariance >= TIER_A.capacityVariance}
        />
      </div>
      <div className="capacity-row">
        <span>Committed vs declared weekly</span>
        <span className="mono">
          {committed} / {p.declaredWeeklyUnits}
        </span>
      </div>
      <div className={`bar${over ? " over" : ""}`}>
        <div style={{ width: `${Math.min(load, 1) * 100}%` }} />
      </div>
      {over && <div className="over-note">Overcommitted by {committed - p.declaredWeeklyUnits} units</div>}
      <div className="materials">
        {p.materialsUsed.map((m) => (
          <span key={m} className="material">{m}</span>
        ))}
      </div>
      <div className="tier-note">{TIER_RULE[p.tier]}</div>
    </section>
  );
}

export default async function ProducersPage() {
  const [producers, committed] = await Promise.all([listProducers(), committedUnitsByProducer()]);
  return (
    <>
      <h1>Producers</h1>
      <p className="subtitle">Tier signals and declared weekly capacity against units in open orders.</p>
      <div className="producer-grid">
        {producers.map((p) => (
          <ProducerCard key={p.id} p={p} committed={committed[p.id] ?? 0} />
        ))}
      </div>
    </>
  );
}

import { useMemo } from 'react';
import { getTier1Color } from '../../lib/colors.js';

export default function KNNVoteTally({ neighbors }) {
  const tally = useMemo(() => {
    if (!neighbors.length) return { votes: [], winner: null, k: 0 };

    const counts = new Map();
    neighbors.forEach(n => {
      const tier1 = n.tier1Parent || 'Unknown';
      counts.set(tier1, (counts.get(tier1) || 0) + 1);
    });

    const votes = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return { votes, winner: votes[0], k: neighbors.length };
  }, [neighbors]);

  if (!tally.votes.length) return null;

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
        KNN Classification Vote
      </h3>
      <div className="space-y-2">
        {tally.votes.map(v => {
          const pct = (v.count / tally.k) * 100;
          return (
            <div key={v.name} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getTier1Color(v.name) }} />
              <span className="text-xs text-[var(--text-primary)] w-36 truncate">{v.name}</span>
              <div className="flex-1 h-4 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: getTier1Color(v.name), opacity: 0.8 }}
                />
              </div>
              <span className="text-xs font-mono text-[var(--text-secondary)] w-16 text-right">
                {v.count} ({pct.toFixed(0)}%)
              </span>
            </div>
          );
        })}
      </div>
      {tally.winner && (
        <div className="mt-3 pt-2 border-t border-[var(--bg-tertiary)] text-xs">
          <span className="text-[var(--text-secondary)]">Classification: </span>
          <span className="text-[var(--text-primary)] font-semibold">{tally.winner.name}</span>
          <span className="text-[var(--text-secondary)]"> ({((tally.winner.count / tally.k) * 100).toFixed(0)}% of K={tally.k} neighbors)</span>
        </div>
      )}
    </div>
  );
}

import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';

export default function ScoreComparison({ scored, channelNeighbors, k }) {
  const comparison = useMemo(() => {
    if (!scored?.length || !channelNeighbors?.length) return [];

    // Compute KNN support per category from channel neighbors
    const knnSupport = new Map();
    channelNeighbors.forEach(ch => {
      const cat = ch.primaryCategory;
      if (!cat) return;
      const prev = knnSupport.get(cat) || 0;
      knnSupport.set(cat, prev + (ch.similarity || 0));
    });
    // Normalize by K
    for (const [cat, val] of knnSupport) {
      knnSupport.set(cat, val / k);
    }

    // Take top 5 L0 categories and compute L1 scores
    return scored.slice(0, 5).map((cat, i) => {
      const l0 = cat.similarity;
      const support = knnSupport.get(cat.tier1Parent) || 0;
      const l1 = 0.75 * l0 + 0.25 * support;
      const delta = l1 - l0;
      return { name: cat.name, tier1: cat.tier1Parent, l0, support, l1, delta, rank: i + 1 };
    });
  }, [scored, channelNeighbors, k]);

  // Compute L1 ranks
  const l1Ranked = useMemo(() => {
    if (!comparison.length) return comparison;
    const sorted = [...comparison].sort((a, b) => b.l1 - a.l1);
    return comparison.map(c => ({
      ...c,
      l1Rank: sorted.findIndex(s => s.name === c.name) + 1,
      rankChanged: sorted.findIndex(s => s.name === c.name) + 1 !== c.rank,
    }));
  }, [comparison]);

  if (!l1Ranked.length) return null;

  const hasRankChange = l1Ranked.some(c => c.rankChanged);

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Load 0 vs Load 1 Scores
        </h3>
        {hasRankChange && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
            Rank changed
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">
              <th className="text-left pb-2 pr-4">Category</th>
              <th className="text-right pb-2 px-2">L0 Score</th>
              <th className="text-right pb-2 px-2">KNN Support</th>
              <th className="text-center pb-2 px-1"></th>
              <th className="text-right pb-2 px-2">L1 Score</th>
              <th className="text-right pb-2 pl-2">Delta</th>
            </tr>
          </thead>
          <tbody>
            {l1Ranked.map((c) => (
              <tr
                key={c.name}
                className={`border-t border-[var(--bg-tertiary)] ${c.rankChanged ? 'bg-amber-500/5' : ''}`}
              >
                <td className="py-1.5 pr-4 text-[var(--text-primary)] font-medium truncate max-w-[180px]">
                  {c.rankChanged && (
                    <span className="text-amber-400 mr-1">#{c.rank}→#{c.l1Rank}</span>
                  )}
                  {c.name}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-[var(--text-secondary)]">
                  {(c.l0 * 100).toFixed(1)}%
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-[var(--text-secondary)]">
                  {(c.support * 100).toFixed(1)}%
                </td>
                <td className="py-1.5 px-1 text-center">
                  <ArrowRight className="w-3 h-3 text-[var(--text-secondary)] inline" />
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-[var(--accent)] font-medium">
                  {(c.l1 * 100).toFixed(1)}%
                </td>
                <td className={`py-1.5 pl-2 text-right font-mono font-medium ${
                  c.delta > 0 ? 'text-emerald-400' : c.delta < 0 ? 'text-red-400' : 'text-[var(--text-secondary)]'
                }`}>
                  {c.delta > 0 ? '+' : ''}{(c.delta * 100).toFixed(1)}pp
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

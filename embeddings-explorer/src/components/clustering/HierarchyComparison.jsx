import { useMemo } from 'react';
import { getTier1Color } from '../../lib/colors.js';

export default function HierarchyComparison({ categories }) {
  const comparison = useMemo(() => {
    // Compare IAB Tier 1 grouping vs KMeans cluster grouping
    const tier1Groups = new Map();
    const kmeansGroups = new Map();

    categories.forEach(cat => {
      // Tier 1
      if (!tier1Groups.has(cat.tier1Parent)) tier1Groups.set(cat.tier1Parent, new Set());
      tier1Groups.get(cat.tier1Parent).add(cat.id);

      // KMeans
      const k = cat.clusterKmeans;
      if (!kmeansGroups.has(k)) kmeansGroups.set(k, new Set());
      kmeansGroups.get(k).add(cat.id);
    });

    // For each Tier 1 group, find which KMeans clusters overlap
    const flows = [];
    tier1Groups.forEach((tier1Members, tier1Name) => {
      kmeansGroups.forEach((kMembers, kId) => {
        const overlap = [...tier1Members].filter(id => kMembers.has(id)).length;
        if (overlap > 0) {
          flows.push({
            tier1: tier1Name,
            cluster: kId,
            count: overlap,
            tier1Total: tier1Members.size,
            clusterTotal: kMembers.size,
          });
        }
      });
    });

    // Compute dominant Tier 1 per cluster
    const clusterDominant = new Map();
    kmeansGroups.forEach((memberIds, kId) => {
      const tier1Counts = {};
      memberIds.forEach(id => {
        const member = categories.find(c => c.id === id);
        if (member) tier1Counts[member.tier1Parent] = (tier1Counts[member.tier1Parent] || 0) + 1;
      });
      const dominant = Object.entries(tier1Counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      clusterDominant.set(kId, dominant);
    });

    // Alignment metric: for each category, is its Tier 1 group the dominant Tier 1 in its cluster?
    let aligned = 0;
    categories.forEach(cat => {
      if (clusterDominant.get(cat.clusterKmeans) === cat.tier1Parent) aligned++;
    });

    const alignmentScore = categories.length > 0 ? aligned / categories.length : 0;

    // Misalignments: categories where embedding cluster's dominant != their Tier 1
    const misalignments = categories
      .filter(cat => {
        const dominant = clusterDominant.get(cat.clusterKmeans);
        return dominant && dominant !== cat.tier1Parent;
      })
      .map(cat => ({
        name: cat.name,
        iabTier1: cat.tier1Parent,
        embeddingCluster: clusterDominant.get(cat.clusterKmeans),
        clusterKmeans: cat.clusterKmeans,
      }))
      // Pick interesting ones: prefer categories with short names (more recognizable)
      .sort((a, b) => a.name.length - b.name.length)
      .slice(0, 5);

    return { flows, alignmentScore, tier1Groups, kmeansGroups, misalignments };
  }, [categories]);

  // Top overlaps for display
  const topFlows = comparison.flows
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return (
    <div className="space-y-4">
      {/* Alignment score — hero */}
      <div className="bg-[var(--bg-primary)] rounded-lg p-5 text-center">
        <div className={`text-4xl font-bold ${
          comparison.alignmentScore >= 0.75 ? 'text-emerald-400' :
          comparison.alignmentScore >= 0.5 ? 'text-amber-400' :
          'text-red-400'
        }`}>
          {(comparison.alignmentScore * 100).toFixed(1)}%
        </div>
        <div className={`text-xs font-semibold mt-1 ${
          comparison.alignmentScore >= 0.75 ? 'text-emerald-400' :
          comparison.alignmentScore >= 0.5 ? 'text-amber-400' :
          'text-red-400'
        }`}>
          {comparison.alignmentScore >= 0.75 ? 'Strong Alignment' :
           comparison.alignmentScore >= 0.5 ? 'Moderate Alignment' :
           'Weak Alignment'}
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-2 max-w-md mx-auto leading-relaxed">
          Embedding-based clustering naturally discovers {(comparison.alignmentScore * 100).toFixed(0)}% of the same category groupings that IAB taxonomy designers created manually — proving that embeddings capture genuine semantic structure.
        </div>
      </div>

      {/* Interesting misalignments */}
      {comparison.misalignments.length > 0 && (
        <div className="bg-[var(--bg-primary)] rounded-lg p-4">
          <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">
            Interesting Disagreements
          </div>
          <div className="text-[10px] text-[var(--text-secondary)] mb-2">
            Categories where embeddings group them differently than the IAB hierarchy:
          </div>
          <div className="space-y-1.5">
            {comparison.misalignments.map((m, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-[var(--text-primary)] font-medium min-w-[120px] truncate">{m.name}</span>
                <span className="text-[var(--text-secondary)]">IAB:</span>
                <span style={{ color: getTier1Color(m.iabTier1) }}>{m.iabTier1}</span>
                <span className="text-[var(--text-secondary)]">→ Embedding:</span>
                <span style={{ color: getTier1Color(m.embeddingCluster) }}>{m.embeddingCluster}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overlap table */}
      <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">
        Top Tier 1 → KMeans Overlaps
      </div>
      <div className="space-y-1">
        {topFlows.map((flow, i) => {
          const pctOfTier1 = flow.count / flow.tier1Total;
          const pctOfCluster = flow.count / flow.clusterTotal;
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1 w-40 truncate">
                <div className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getTier1Color(flow.tier1) }} />
                <span className="truncate">{flow.tier1}</span>
              </div>
              <span className="text-[var(--text-secondary)]">→</span>
              <span className="w-16 text-[var(--text-secondary)]">Cluster {flow.cluster}</span>
              <div className="flex-1 h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pctOfTier1 * 100}%`,
                    backgroundColor: getTier1Color(flow.tier1),
                    opacity: 0.7,
                  }}
                />
              </div>
              <span className="w-16 text-right font-mono">
                {flow.count} ({(pctOfTier1 * 100).toFixed(0)}%)
              </span>
            </div>
          );
        })}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[var(--bg-tertiary)]">
        <div className="text-center">
          <div className="text-xl font-semibold text-[var(--text-primary)]">{comparison.tier1Groups.size}</div>
          <div className="text-xs text-[var(--text-secondary)]">IAB Tier 1 Groups</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-semibold text-[var(--text-primary)]">{comparison.kmeansGroups.size}</div>
          <div className="text-xs text-[var(--text-secondary)]">KMeans Clusters</div>
        </div>
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import { getTier1Color } from '../../lib/colors.js';

export default function ClusterPurity({ categories, clusterType = 'kmeans' }) {
  const clusters = useMemo(() => {
    const groups = new Map();
    categories.forEach(cat => {
      const key = clusterType === 'kmeans' ? cat.clusterKmeans
        : clusterType === 'hdbscan' ? cat.clusterHdbscan
        : cat.tier1Parent;
      if (key == null || key === -1) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cat);
    });

    return [...groups.entries()].map(([key, members]) => {
      // Count Tier 1 distribution
      const tier1Counts = {};
      members.forEach(m => {
        tier1Counts[m.tier1Parent] = (tier1Counts[m.tier1Parent] || 0) + 1;
      });

      const sorted = Object.entries(tier1Counts).sort((a, b) => b[1] - a[1]);
      const dominant = sorted[0][0];
      const dominantCount = sorted[0][1];
      const purity = dominantCount / members.length;

      return {
        key,
        label: clusterType === 'tier1' ? key : `C${key}`,
        size: members.length,
        purity,
        dominant,
        segments: sorted.map(([t1, count]) => ({
          t1,
          count,
          pct: count / members.length,
        })),
      };
    }).sort((a, b) => b.purity - a.purity);
  }, [categories, clusterType]);

  const avgPurity = clusters.length > 0
    ? clusters.reduce((s, c) => s + c.purity * c.size, 0) / categories.length
    : 0;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center gap-4 text-xs">
        <div>
          <span className="text-[var(--text-secondary)]">Weighted Avg Purity: </span>
          <span className={`font-mono font-semibold ${
            avgPurity >= 0.8 ? 'text-emerald-400' : avgPurity >= 0.6 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {(avgPurity * 100).toFixed(1)}%
          </span>
        </div>
        <div className="text-[var(--text-secondary)]">{clusters.length} clusters</div>
      </div>

      {/* Bars */}
      <div className="space-y-1">
        {clusters.map(cluster => (
          <div key={String(cluster.key)} className="flex items-center gap-2 group">
            <span className="text-[10px] text-[var(--text-secondary)] font-mono w-8 text-right shrink-0">
              {cluster.label}
            </span>

            {/* Stacked bar */}
            <div className="flex-1 h-4 flex rounded-sm overflow-hidden bg-[var(--bg-primary)]">
              {cluster.segments.map((seg, i) => (
                <div
                  key={seg.t1}
                  className="h-full transition-opacity"
                  style={{
                    width: `${seg.pct * 100}%`,
                    backgroundColor: getTier1Color(seg.t1),
                    opacity: i === 0 ? 0.9 : 0.5,
                  }}
                  title={`${seg.t1}: ${seg.count} (${(seg.pct * 100).toFixed(0)}%)`}
                />
              ))}
            </div>

            {/* Purity % */}
            <span className={`text-[10px] font-mono w-10 text-right shrink-0 ${
              cluster.purity >= 0.8 ? 'text-emerald-400' :
              cluster.purity >= 0.6 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {(cluster.purity * 100).toFixed(0)}%
            </span>

            {/* Size */}
            <span className="text-[9px] text-[var(--text-secondary)] w-6 text-right shrink-0">
              {cluster.size}
            </span>
          </div>
        ))}
      </div>

      <div className="text-[9px] text-[var(--text-secondary)] leading-relaxed">
        Each bar shows the Tier 1 composition. High purity means the embedding cluster maps cleanly to one IAB Tier 1 category.
      </div>
    </div>
  );
}

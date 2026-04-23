import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { getTier1Color } from '../../lib/colors.js';

export default function ClusterExplorer({ categories, clusterType, selectedCluster, onSelectCluster, onViewIn3D }) {
  const clusters = useMemo(() => {
    const groups = new Map();
    categories.forEach(cat => {
      let key;
      if (clusterType === 'tier1') key = cat.tier1Parent;
      else if (clusterType === 'kmeans') key = cat.clusterKmeans;
      else key = cat.clusterHdbscan;

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cat);
    });

    return [...groups.entries()]
      .map(([key, members]) => ({
        key,
        label: clusterType === 'tier1' ? key : `Cluster ${key}`,
        members,
        size: members.length,
        dominantTier1: getMostCommon(members.map(m => m.tier1Parent)),
      }))
      .sort((a, b) => b.size - a.size);
  }, [categories, clusterType]);

  return (
    <div className="space-y-2 max-h-[600px] overflow-y-auto">
      {clusters.map(cluster => {
        const isSelected = selectedCluster === cluster.key;
        const color = clusterType === 'tier1'
          ? getTier1Color(cluster.key)
          : getTier1Color(cluster.dominantTier1);

        return (
          <button
            key={String(cluster.key)}
            onClick={() => onSelectCluster(isSelected ? null : cluster.key)}
            className={`w-full text-left p-3 rounded-lg border transition-all ${
              isSelected
                ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                : 'border-[var(--bg-tertiary)] hover:border-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)]/30'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm font-medium text-[var(--text-primary)]">{cluster.label}</span>
              </div>
              <span className="text-xs text-[var(--text-secondary)]">{cluster.size} categories</span>
            </div>

            {isSelected && (
              <div className="mt-2">
                <div className="space-y-1">
                  {cluster.members.slice(0, 15).map(m => (
                    <div key={m.id} className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)] truncate max-w-[200px]" title={m.name}>{m.name}</span>
                      <span className="text-[var(--text-secondary)] font-mono ml-2">T{m.tierLevel}</span>
                    </div>
                  ))}
                  {cluster.members.length > 15 && (
                    <div className="text-xs text-[var(--text-secondary)] italic">
                      +{cluster.members.length - 15} more
                    </div>
                  )}
                </div>
                {onViewIn3D && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onViewIn3D(cluster.key, clusterType); }}
                    className="mt-2 flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-white transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    View in 3D
                  </button>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function getMostCommon(arr) {
  const counts = {};
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
}

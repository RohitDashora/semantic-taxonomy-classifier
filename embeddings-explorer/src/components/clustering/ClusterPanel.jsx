import { Layers } from 'lucide-react';

export default function ClusterPanel({ clusterType, onClusterTypeChange }) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-[var(--accent)]" />
        <h2 className="text-lg font-semibold">Clustering Analysis</h2>
      </div>

      <div className="flex rounded-lg overflow-hidden border border-[var(--bg-tertiary)]">
        {[
          { key: 'kmeans', label: 'KMeans (30)' },
          { key: 'hdbscan', label: 'HDBSCAN' },
          { key: 'tier1', label: 'IAB Tier 1' },
        ].map(opt => (
          <button
            key={opt.key}
            onClick={() => onClusterTypeChange(opt.key)}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              clusterType === opt.key
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

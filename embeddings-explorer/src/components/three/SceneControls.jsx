import { Eye, Layers, Target } from 'lucide-react';

export default function SceneControls({
  projection,
  onProjectionChange,
  showClusters,
  onShowClustersChange,
  clusterType,
  onClusterTypeChange,
  clusterKeys,
  selectedCluster,
  onSelectCluster,
}) {
  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
      {/* Projection toggle */}
      <div className="bg-[#1e293b]/90 backdrop-blur rounded-lg p-2 border border-[#475569]/50">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Eye className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span className="text-xs text-[var(--text-secondary)]">Projection</span>
        </div>
        <div className="flex rounded overflow-hidden">
          {['umap', 'tsne'].map(p => (
            <button
              key={p}
              onClick={() => onProjectionChange(p)}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                projection === p
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Cluster toggle */}
      <div className="bg-[#1e293b]/90 backdrop-blur rounded-lg p-2 border border-[#475569]/50">
        <label className="flex items-center gap-1.5 cursor-pointer mb-1.5">
          <input
            type="checkbox"
            checked={showClusters}
            onChange={(e) => onShowClustersChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
          />
          <Layers className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span className="text-xs text-[var(--text-secondary)]">Cluster Hulls</span>
        </label>

        {showClusters && (
          <div className="flex flex-col gap-1">
            {[
              { key: 'tier1', label: 'IAB Tier 1' },
              { key: 'kmeans', label: 'KMeans (30)' },
              { key: 'hdbscan', label: 'HDBSCAN' },
            ].map(opt => (
              <label key={opt.key} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="clusterType"
                  checked={clusterType === opt.key}
                  onChange={() => onClusterTypeChange(opt.key)}
                  className="w-3 h-3 accent-[var(--accent)]"
                />
                <span className="text-xs text-[var(--text-secondary)]">{opt.label}</span>
              </label>
            ))}
          </div>
        )}

        {/* Cluster picker */}
        {showClusters && clusterKeys && clusterKeys.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-[#475569]/30">
            <div className="flex items-center gap-1.5 mb-1">
              <Target className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span className="text-[10px] text-[var(--text-secondary)]">Isolate Cluster</span>
            </div>
            <select
              value={selectedCluster ?? '__all__'}
              onChange={e => onSelectCluster(e.target.value === '__all__' ? null : e.target.value)}
              className="w-full text-xs bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[#475569]/50 rounded px-2 py-1 outline-none focus:border-[var(--accent)]"
            >
              <option value="__all__">All Clusters</option>
              {clusterKeys.map(k => (
                <option key={String(k)} value={String(k)}>
                  {clusterType === 'tier1' ? k : `Cluster ${k}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

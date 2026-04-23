import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import ClusterPanel from '../components/clustering/ClusterPanel.jsx';
import ClusterExplorer from '../components/clustering/ClusterExplorer.jsx';
import Dendrogram from '../components/clustering/Dendrogram.jsx';
import HierarchyComparison from '../components/clustering/HierarchyComparison.jsx';
import ConfusionMatrix from '../components/clustering/ConfusionMatrix.jsx';
import ClusterPurity from '../components/clustering/ClusterPurity.jsx';
import InsightPanel from '../components/shared/InsightPanel.jsx';

export default function ClusteringView({ categories, embedding, scored }) {
  const [clusterType, setClusterType] = useState('kmeans');
  const [selectedCluster, setSelectedCluster] = useState(null);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <ClusterPanel clusterType={clusterType} onClusterTypeChange={setClusterType} />

      {/* Hero row: Alignment Score | Insight | Purity */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Alignment score — promoted to hero */}
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
            Hierarchy vs. Embedding Alignment
          </h3>
          <HierarchyComparison categories={categories} />
        </div>

        {/* Insight panel */}
        <InsightPanel title="What This Page Shows" icon={<BookOpen className="w-3.5 h-3.5" />}>
          <p className="mb-1.5">
            Do embeddings <strong className="text-[var(--text-primary)]">agree</strong> with the human-curated IAB taxonomy? We compare how <code className="text-[10px]">databricks-gte-large-en</code> naturally clusters 698 categories vs. the official Tier 1 groupings.
          </p>
          <p className="mb-1.5">
            <strong className="text-[var(--text-primary)]">High alignment</strong> validates that Load 0 classification captures real semantic structure — not just string matching.
          </p>
          <p>
            <strong className="text-[var(--text-primary)]">Disagreements</strong> reveal categories where embeddings see relationships the taxonomy doesn't — potential improvements or interesting edge cases.
          </p>
        </InsightPanel>

        {/* Cluster purity */}
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
            Cluster Purity — {clusterType === 'tier1' ? 'IAB Tier 1' : clusterType === 'kmeans' ? 'KMeans' : 'HDBSCAN'}
          </h3>
          <ClusterPurity categories={categories} clusterType={clusterType} />
        </div>
      </div>

      {/* Confusion matrix — full width */}
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">
          Tier 1 × KMeans Confusion Matrix
        </h3>
        <p className="text-[10px] text-[var(--text-secondary)] mb-3">
          Each cell shows how many categories from a Tier 1 group (row) land in a KMeans cluster (column). Bright cells = strong overlap. A clean diagonal would mean perfect alignment.
        </p>
        <ConfusionMatrix categories={categories} />
      </div>

      {/* Bottom row: Cluster Explorer | Dendrogram */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
            Cluster Explorer
          </h3>
          <ClusterExplorer
            categories={categories}
            clusterType={clusterType}
            selectedCluster={selectedCluster}
            onSelectCluster={setSelectedCluster}
          />
        </div>

        <div className="xl:col-span-2 bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
            Hierarchical Dendrogram (Ward Linkage)
          </h3>
          <Dendrogram categories={categories} />
        </div>
      </div>
    </div>
  );
}

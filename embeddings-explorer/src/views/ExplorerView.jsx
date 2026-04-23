import { useState, useMemo, useCallback, useEffect } from 'react';
import { X, BookOpen, Filter } from 'lucide-react';
import EmbeddingScene from '../components/three/EmbeddingScene.jsx';
import SceneControls from '../components/three/SceneControls.jsx';
import InsightPanel from '../components/shared/InsightPanel.jsx';
import { getTier1Color, getAllTier1Colors } from '../lib/colors.js';
import { cosineSimilarity } from '../lib/cosine.js';

export default function ExplorerView({
  categories,
  embedding,
  scored,
  assigned,
  threshold,
  projection,
  onProjectionChange,
  inputText,
  latency,
}) {
  const [showClusters, setShowClusters] = useState(false);
  const [clusterType, setClusterType] = useState('tier1');
  const [highlightCluster, setHighlightCluster] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [focusTarget, setFocusTarget] = useState(null);
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [filterCategory, setFilterCategory] = useState(null);

  // Auto-filter to classified category
  useEffect(() => {
    if (scored?.length > 0) {
      setFilterCategory(scored[0].tier1Parent);
    } else {
      setFilterCategory(null);
    }
  }, [scored]);

  // Reset selected cluster when cluster type changes
  useEffect(() => {
    setSelectedCluster(null);
  }, [clusterType]);

  // Available cluster keys for the dropdown
  const clusterKeys = useMemo(() => {
    const keys = new Set();
    categories.forEach(cat => {
      let key;
      if (clusterType === 'tier1') key = cat.tier1Parent;
      else if (clusterType === 'kmeans') key = cat.clusterKmeans;
      else key = cat.clusterHdbscan;
      if (key !== -1 && key != null) keys.add(key);
    });
    const arr = [...keys];
    if (clusterType === 'tier1') arr.sort();
    else arr.sort((a, b) => Number(a) - Number(b));
    return arr;
  }, [categories, clusterType]);

  // Categories in the selected cluster
  const clusterMembers = useMemo(() => {
    if (selectedCluster == null) return [];
    return categories.filter(cat => {
      let key;
      if (clusterType === 'tier1') key = cat.tier1Parent;
      else if (clusterType === 'kmeans') key = String(cat.clusterKmeans);
      else key = String(cat.clusterHdbscan);
      return String(key) === String(selectedCluster);
    });
  }, [categories, clusterType, selectedCluster]);

  // THE SIMPLE RULE: what to display in the 3D scene
  const displayCategories = useMemo(() => {
    if (selectedCluster != null && clusterMembers.length > 0) return clusterMembers;
    if (assigned?.length) {
      const matchedIds = new Set(assigned.map(a => a.id));
      return categories.filter(c => matchedIds.has(c.id));
    }
    if (filterCategory) {
      return categories.filter(c => c.tier1Parent === filterCategory);
    }
    return categories;
  }, [categories, assigned, selectedCluster, clusterMembers, filterCategory]);

  // Cluster stats for info overlay
  const clusterStats = useMemo(() => {
    if (selectedCluster == null || clusterMembers.length < 2) return null;

    const members = clusterMembers.slice(0, 50);
    let totalSim = 0;
    let count = 0;
    const topPairs = [];

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const sim = cosineSimilarity(members[i].embedding, members[j].embedding);
        totalSim += sim;
        count++;
        if (topPairs.length < 3 || sim > topPairs[topPairs.length - 1].sim) {
          topPairs.push({ a: members[i].name, b: members[j].name, sim });
          topPairs.sort((x, y) => y.sim - x.sim);
          if (topPairs.length > 3) topPairs.pop();
        }
      }
    }

    return {
      memberCount: clusterMembers.length,
      avgSimilarity: count > 0 ? totalSim / count : 0,
      topPairs,
    };
  }, [selectedCluster, clusterMembers]);

  // Fly camera to cluster centroid when cluster selected
  useEffect(() => {
    if (selectedCluster == null || clusterMembers.length === 0) return;
    const coordKey = projection === 'tsne' ? 'tsne' : 'umap';
    let cx = 0, cy = 0, cz = 0;
    clusterMembers.forEach(cat => {
      const pos = cat[coordKey];
      cx += pos[0]; cy += pos[1]; cz += pos[2];
    });
    const n = clusterMembers.length;
    setFocusTarget([cx / n, cy / n, cz / n]);
  }, [selectedCluster, clusterMembers, projection]);

  // Reset cluster state when classification is cleared
  useEffect(() => {
    if (!assigned?.length && selectedCluster != null) {
      setSelectedCluster(null);
    }
  }, [assigned, selectedCluster]);

  const finalShowClusters = selectedCluster != null ? true : showClusters;
  const finalHighlightCluster = selectedCluster != null
    ? (clusterType === 'tier1' ? selectedCluster : Number(selectedCluster))
    : highlightCluster;

  const simMap = useMemo(() => {
    const map = new Map();
    if (scored) scored.forEach(s => map.set(s.id, s.similarity));
    return map;
  }, [scored]);

  const handleSelectCategory = useCallback((cat) => {
    setSelectedCategory(cat);
    const pos = projection === 'tsne' ? cat.tsne : cat.umap;
    setFocusTarget([...pos]);
  }, [projection]);

  const handleSidebarClick = useCallback((cat) => {
    const fullCat = categories.find(c => c.id === cat.id);
    if (fullCat) handleSelectCategory(fullCat);
  }, [categories, handleSelectCategory]);

  const handleCloseDetail = useCallback(() => {
    setSelectedCategory(null);
    setFocusTarget(null);
  }, []);

  const handleSelectCluster = useCallback((key) => {
    setSelectedCluster(key);
    if (key == null) setFocusTarget(null);
  }, []);

  // Tier 1 color legend
  const tier1Legend = useMemo(() => {
    const colorMap = getAllTier1Colors();
    const entries = [];
    const counts = new Map();
    categories.forEach(cat => {
      counts.set(cat.tier1Parent, (counts.get(cat.tier1Parent) || 0) + 1);
    });
    for (const [name, color] of colorMap) {
      entries.push({ name, color, count: counts.get(name) || 0 });
    }
    entries.sort((a, b) => b.count - a.count);
    return entries;
  }, [categories]);

  return (
    <div className="relative w-full h-full border-t border-[var(--bg-tertiary)]">
      <SceneControls
        projection={projection}
        onProjectionChange={onProjectionChange}
        showClusters={showClusters}
        onShowClustersChange={setShowClusters}
        clusterType={clusterType}
        onClusterTypeChange={setClusterType}
        clusterKeys={clusterKeys}
        selectedCluster={selectedCluster}
        onSelectCluster={handleSelectCluster}
      />

      <EmbeddingScene
        categories={categories}
        displayCategories={displayCategories}
        projection={projection}
        embedding={embedding}
        scored={scored}
        assigned={assigned}
        showClusters={finalShowClusters}
        clusterType={clusterType}
        highlightCluster={finalHighlightCluster}
        onSelectCategory={handleSelectCategory}
        selectedCategory={selectedCategory}
        focusTarget={focusTarget}
        selectedCluster={selectedCluster}
        clusterMembers={clusterMembers}
      />

      {/* Insight panel — top right of 3D viewport */}
      <div className="absolute top-4 right-4 w-64 z-10 flex flex-col gap-2">
        {!assigned?.length && (
          <InsightPanel title="IAB Taxonomy in Embedding Space" icon={<BookOpen className="w-3.5 h-3.5" />}>
            <p className="mb-1.5">
              Each point is one of {categories.length} IAB content categories, positioned by its <strong className="text-[var(--text-primary)]">embedding</strong> — a 1024-dim vector from <code className="text-[10px]">databricks-gte-large-en</code>.
            </p>
            <p className="mb-1.5">
              Points close together are semantically similar. Colors represent the 26 IAB Tier 1 groups.
            </p>
            <p>
              When you classify a channel, we show where it lands relative to these categories — the basis of our <strong className="text-[var(--text-primary)]">Load 0</strong> semantic classification.
            </p>
          </InsightPanel>
        )}
      </div>

      {/* Welcome overlay */}
      {!embedding && !selectedCategory && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#1e293b]/95 backdrop-blur rounded-lg px-6 py-4 border border-[#475569]/50 text-center max-w-lg shadow-lg">
          <p className="text-[var(--text-primary)] text-sm font-medium mb-1">
            Explore the IAB Taxonomy in Embedding Space
          </p>
          <p className="text-[var(--text-secondary)] text-xs leading-relaxed mb-2">
            Each point is one of {categories.length} IAB content categories. When you classify a channel, we show where it lands relative to these categories.
          </p>
          <p className="text-[var(--accent)] text-xs font-medium mb-2">
            Try it: Search a YouTube channel above to see which IAB categories it maps to.
          </p>
          <p className="text-[var(--text-secondary)] text-[10px]">
            Scroll to zoom &middot; Drag to rotate &middot; Click any point for details
          </p>
        </div>
      )}

      {/* Post-analysis result overlay */}
      {embedding && !selectedCategory && scored?.length > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#1e293b]/95 backdrop-blur rounded-lg px-5 py-3 border border-[#475569]/50 text-center max-w-lg shadow-lg">
          {inputText && (
            <p className="text-[var(--text-secondary)] text-[10px] mb-1 truncate max-w-xs mx-auto">
              "{inputText}"
            </p>
          )}
          <p className="text-[var(--text-primary)] text-sm font-medium">
            Load 0 Result: {scored[0].name}
            <span className="text-[var(--accent)] ml-2 font-mono text-xs">
              {(scored[0].similarity * 100).toFixed(1)}%
            </span>
          </p>
          <p className="text-[var(--text-secondary)] text-[10px] mt-1">
            {assigned?.length || 0} categories assigned
            {latency && <span> &middot; Embedding: {latency}ms</span>}
          </p>
        </div>
      )}

      {/* Cluster info overlay */}
      {selectedCluster != null && clusterStats && (
        <div className="absolute bottom-6 left-6 bg-[#1e293b]/95 backdrop-blur rounded-lg border border-[#475569]/50 p-3 shadow-xl max-w-sm">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: clusterType === 'tier1' ? getTier1Color(selectedCluster) : '#3b82f6' }}
            />
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">
              {clusterType === 'tier1' ? selectedCluster : `Cluster ${selectedCluster}`}
            </h3>
            <span className="text-[10px] text-[var(--text-secondary)]">
              {clusterStats.memberCount} categories
            </span>
          </div>
          <div className="text-[10px] text-[var(--text-secondary)] mb-2">
            Avg pairwise similarity: <span className="text-[var(--accent)] font-mono">{(clusterStats.avgSimilarity * 100).toFixed(1)}%</span>
          </div>
          {clusterStats.topPairs.length > 0 && (
            <div className="text-[10px] text-[var(--text-secondary)]">
              <span className="text-[var(--text-secondary)] font-medium">Strongest connections:</span>
              {clusterStats.topPairs.map((p, i) => (
                <div key={i} className="mt-0.5 truncate">
                  {p.a} &harr; {p.b}
                  <span className="text-[var(--success)] font-mono ml-1">{(p.sim * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category filter — bottom left */}
      {!selectedCluster && (
        <div className="absolute bottom-6 left-4 bg-[#1e293b]/90 backdrop-blur rounded-lg border border-[#475569]/50 p-2.5 w-52 z-10">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3 h-3 text-[var(--text-secondary)]" />
              <span className="text-[10px] font-semibold text-[var(--text-primary)]">Tier 1 Categories</span>
            </div>
            {filterCategory && (
              <button
                onClick={() => setFilterCategory(null)}
                className="flex items-center gap-0.5 text-[8px] text-[var(--accent)] hover:text-white transition-colors"
              >
                <X className="w-2.5 h-2.5" />
                Clear
              </button>
            )}
          </div>

          {filterCategory && (
            <div className="mb-1.5 px-1.5 py-1 rounded bg-[var(--accent)]/15 border border-[var(--accent)]/30 flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getTier1Color(filterCategory) }} />
              <span className="text-[9px] text-[var(--accent)] font-medium truncate">{filterCategory}</span>
              <span className="text-[9px] text-[var(--text-secondary)] font-mono ml-auto">
                {displayCategories.length}
              </span>
            </div>
          )}

          <div className="space-y-0 max-h-[300px] overflow-y-auto">
            {tier1Legend.map(entry => {
              const isActive = filterCategory === entry.name;
              return (
                <button
                  key={entry.name}
                  onClick={() => setFilterCategory(isActive ? null : entry.name)}
                  className={`flex items-center gap-1.5 w-full rounded px-1 py-0.5 transition-colors text-left ${
                    isActive
                      ? 'bg-[var(--accent)]/10'
                      : filterCategory && !isActive
                      ? 'opacity-40 hover:opacity-70'
                      : 'hover:bg-[var(--bg-tertiary)]/30'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className="text-[9px] text-[var(--text-secondary)] truncate flex-1">{entry.name}</span>
                  <span className="text-[8px] text-[var(--text-secondary)] font-mono">{entry.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected category detail panel */}
      {selectedCategory && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#1e293b]/95 backdrop-blur rounded-lg border border-[#475569]/50 p-4 shadow-xl min-w-[320px] max-w-md">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: getTier1Color(selectedCategory.tier1Parent) }}
              />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {selectedCategory.name}
              </h3>
            </div>
            <button
              onClick={handleCloseDetail}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-xs text-[var(--text-secondary)] mb-2">{selectedCategory.tierPath}</div>
          {selectedCategory.description && (
            <p className="text-xs text-[var(--text-secondary)] mb-2 leading-relaxed">
              {selectedCategory.description}
            </p>
          )}
          <div className="flex gap-4 text-[10px] text-[var(--text-secondary)]">
            <span>Tier Level: {selectedCategory.tierLevel}</span>
            <span>Parent: {selectedCategory.tier1Parent}</span>
            {simMap.get(selectedCategory.id) !== undefined && (
              <span className="text-cyan-400 font-mono">
                Similarity: {(simMap.get(selectedCategory.id) * 100).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Assigned categories sidebar */}
      {assigned && assigned.length > 0 && (
        <div className="absolute top-4 right-4 w-64 max-h-[calc(100%-2rem)] overflow-y-auto bg-[#1e293b]/95 backdrop-blur rounded-lg border border-[#475569]/50 p-3 shadow-lg">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
            Assigned Categories ({assigned.length})
          </h3>
          {assigned.map((cat, i) => (
            <div
              key={cat.id}
              onClick={() => handleSidebarClick(cat)}
              className="flex items-center justify-between py-1.5 border-b border-[var(--bg-tertiary)] last:border-0 cursor-pointer hover:bg-[var(--bg-tertiary)]/50 rounded px-1 -mx-1 transition-colors"
              title={cat.tierPath}
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                  {i === 0 && <span className="text-amber-400 mr-1">*</span>}
                  {cat.name}
                </div>
                <div className="text-[10px] text-[var(--text-secondary)] truncate">{cat.tierPath}</div>
              </div>
              <span className={`ml-2 text-xs font-mono ${cat.similarity >= 0.5 ? 'text-[var(--success)]' : 'text-[var(--accent)]'}`}>
                {(cat.similarity * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

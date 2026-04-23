import { useMemo, useState, useEffect } from 'react';
import { Eye, ChevronDown, ChevronRight, Loader2, AlertCircle, RefreshCw, Filter, X } from 'lucide-react';
import GalaxyScene from '../components/three/GalaxyScene.jsx';
import { getTier1Color } from '../lib/colors.js';

export default function ChannelGalaxyView({
  categories,
  channelSample,
  channelLoading,
  channelError,
  onRetryChannels,
  embedding,
  scored,
  assigned,
  projection,
  onProjectionChange,
  inputText,
}) {
  const [showDisagreements, setShowDisagreements] = useState(false);
  const [filterCategory, setFilterCategory] = useState(null);

  // Auto-filter to classified category when user analyzes text
  useEffect(() => {
    if (scored?.length > 0) {
      setFilterCategory(scored[0].tier1Parent);
    } else {
      setFilterCategory(null);
    }
  }, [scored]);

  // Category distribution from channel sample
  const distribution = useMemo(() => {
    if (!channelSample?.length) return [];
    const counts = {};
    channelSample.forEach(ch => {
      counts[ch.primaryCategory] = (counts[ch.primaryCategory] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count, pct: count / channelSample.length }))
      .sort((a, b) => b.count - a.count);
  }, [channelSample]);

  // Filtered channels for 3D scene
  const filteredChannels = useMemo(() => {
    if (!filterCategory || !channelSample?.length) return channelSample;
    return channelSample.filter(ch => ch.primaryCategory === filterCategory);
  }, [channelSample, filterCategory]);

  // Alignment score (inlined from HierarchyComparison)
  const { alignmentScore, misalignments } = useMemo(() => {
    if (!categories.length) return { alignmentScore: 0, misalignments: [] };

    const kmeansGroups = new Map();
    categories.forEach(cat => {
      const k = cat.clusterKmeans;
      if (!kmeansGroups.has(k)) kmeansGroups.set(k, []);
      kmeansGroups.get(k).push(cat);
    });

    const clusterDominant = new Map();
    kmeansGroups.forEach((members, kId) => {
      const tier1Counts = {};
      members.forEach(m => {
        tier1Counts[m.tier1Parent] = (tier1Counts[m.tier1Parent] || 0) + 1;
      });
      const dominant = Object.entries(tier1Counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      clusterDominant.set(kId, dominant);
    });

    let aligned = 0;
    categories.forEach(cat => {
      if (clusterDominant.get(cat.clusterKmeans) === cat.tier1Parent) aligned++;
    });

    const mis = categories
      .filter(cat => {
        const dominant = clusterDominant.get(cat.clusterKmeans);
        return dominant && dominant !== cat.tier1Parent;
      })
      .map(cat => ({
        name: cat.name,
        iabTier1: cat.tier1Parent,
        embeddingCluster: clusterDominant.get(cat.clusterKmeans),
      }))
      .sort((a, b) => a.name.length - b.name.length)
      .slice(0, 3);

    return { alignmentScore: categories.length > 0 ? aligned / categories.length : 0, misalignments: mis };
  }, [categories]);

  // User's neighborhood in the galaxy
  const userNeighborhood = useMemo(() => {
    if (!scored?.length || !channelSample?.length) return null;
    const topCategory = scored[0].tier1Parent;
    const sameCategory = channelSample.filter(ch => ch.primaryCategory === topCategory);
    return { category: topCategory, neighbors: sameCategory.length, total: channelSample.length };
  }, [scored, channelSample]);

  if (channelError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <AlertCircle className="w-10 h-10 text-[var(--danger)] mx-auto mb-3" />
          <p className="text-[var(--text-primary)] text-sm font-medium mb-2">Channel Galaxy Unavailable</p>
          <p className="text-[var(--text-secondary)] text-xs mb-4">{channelError}</p>
          {onRetryChannels && (
            <button
              onClick={onRetryChannels}
              className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-dim)] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (channelLoading || !channelSample?.length) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)] mx-auto mb-3" />
          <p className="text-[var(--text-secondary)] text-sm">Loading channel galaxy...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full border-t border-[var(--bg-tertiary)]">
      <GalaxyScene
        categories={categories}
        channelSample={filteredChannels}
        projection={projection}
        embedding={embedding}
        scored={scored}
        focusTarget={null}
        filterCategory={filterCategory}
      />

      {/* Top-left: Projection toggle + count */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
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

        <div className="bg-[#1e293b]/90 backdrop-blur rounded-lg px-3 py-2 border border-[#475569]/50">
          <div className="text-lg font-bold text-[var(--text-primary)]">
            {filteredChannels.length.toLocaleString()}
            {filterCategory && (
              <span className="text-xs font-normal text-[var(--text-secondary)]"> / {channelSample.length.toLocaleString()}</span>
            )}
          </div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            {filterCategory ? `Filtered: ${filterCategory}` : 'Classified Channels'}
          </div>
        </div>
      </div>

      {/* Bottom-left: Category distribution (clickable to filter) */}
      <div className="absolute bottom-6 left-4 z-10 bg-[#1e293b]/90 backdrop-blur rounded-lg border border-[#475569]/50 p-3 w-64">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3 h-3 text-[var(--text-secondary)]" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">Categories</span>
          </div>
          {filterCategory && (
            <button
              onClick={() => setFilterCategory(null)}
              className="flex items-center gap-1 text-[9px] text-[var(--accent)] hover:text-white transition-colors"
            >
              <X className="w-3 h-3" />
              Clear filter
            </button>
          )}
        </div>

        {filterCategory && (
          <div className="mb-2 px-2 py-1.5 rounded bg-[var(--accent)]/15 border border-[var(--accent)]/30 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getTier1Color(filterCategory) }} />
            <span className="text-[10px] text-[var(--accent)] font-medium truncate">{filterCategory}</span>
            <span className="text-[10px] text-[var(--text-secondary)] font-mono ml-auto">{filteredChannels.length}</span>
          </div>
        )}

        <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
          {distribution.map(d => {
            const isActive = filterCategory === d.name;
            return (
              <button
                key={d.name}
                onClick={() => setFilterCategory(isActive ? null : d.name)}
                className={`flex items-center gap-2 text-[10px] w-full rounded px-1 py-0.5 transition-colors ${
                  isActive
                    ? 'bg-[var(--accent)]/10'
                    : filterCategory && !isActive
                    ? 'opacity-40 hover:opacity-70'
                    : 'hover:bg-[var(--bg-tertiary)]/30'
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getTier1Color(d.name) }}
                />
                <span className="text-[var(--text-secondary)] truncate flex-1 text-left">{d.name}</span>
                <div className="w-16 h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden flex-shrink-0">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${d.pct * 100}%`, backgroundColor: getTier1Color(d.name), opacity: 0.7 }}
                  />
                </div>
                <span className="text-[var(--text-secondary)] font-mono w-8 text-right">{d.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom-center: User result overlay */}
      {embedding && scored?.length > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-[#1e293b]/95 backdrop-blur rounded-lg px-5 py-3 border border-[#475569]/50 text-center max-w-lg shadow-lg">
          {inputText && (
            <p className="text-[var(--text-secondary)] text-[10px] mb-1 truncate max-w-xs mx-auto">
              "{inputText}"
            </p>
          )}
          <p className="text-[var(--text-primary)] text-sm font-medium">
            {scored[0].name}
            <span className="text-[var(--accent)] ml-2 font-mono text-xs">
              {(scored[0].similarity * 100).toFixed(1)}%
            </span>
          </p>
          {userNeighborhood && (
            <p className="text-[var(--text-secondary)] text-[10px] mt-1">
              {userNeighborhood.neighbors} of {userNeighborhood.total.toLocaleString()} channels share the {userNeighborhood.category} category
            </p>
          )}
        </div>
      )}

      {/* Welcome overlay when no classification */}
      {!embedding && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-[#1e293b]/95 backdrop-blur rounded-lg px-6 py-4 border border-[#475569]/50 text-center max-w-lg shadow-lg">
          <p className="text-[var(--text-primary)] text-sm font-medium mb-1">
            {channelSample.length.toLocaleString()} YouTube Channels in Embedding Space
          </p>
          <p className="text-[var(--text-secondary)] text-xs leading-relaxed mb-2">
            Each dot is a real YouTube channel, positioned by its embedding and colored by its classified IAB category. The bright anchor points are the 26 IAB Tier 1 categories.
          </p>
          <p className="text-[var(--accent)] text-xs font-medium">
            Classify a channel above to see where it lands among the galaxy.
          </p>
        </div>
      )}

      {/* Bottom-right: Alignment score */}
      <div className="absolute bottom-6 right-4 z-10 bg-[#1e293b]/90 backdrop-blur rounded-lg border border-[#475569]/50 p-3 w-56">
        <div className="text-center mb-2">
          <div className={`text-2xl font-bold ${
            alignmentScore >= 0.75 ? 'text-emerald-400' :
            alignmentScore >= 0.5 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {(alignmentScore * 100).toFixed(0)}%
          </div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            Embedding ↔ Taxonomy Alignment
          </div>
        </div>
        <p className="text-[9px] text-[var(--text-secondary)] leading-relaxed text-center">
          Embedding clusters discover {(alignmentScore * 100).toFixed(0)}% of the same groupings IAB designers created manually.
        </p>

        {misalignments.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#475569]/30">
            <button
              onClick={() => setShowDisagreements(!showDisagreements)}
              className="flex items-center gap-1 text-[9px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors w-full"
            >
              {showDisagreements ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Interesting disagreements
            </button>
            {showDisagreements && (
              <div className="mt-1 space-y-1">
                {misalignments.map((m, i) => (
                  <div key={i} className="text-[9px]">
                    <span className="text-[var(--text-primary)]">{m.name}</span>
                    <span className="text-[var(--text-secondary)]"> — IAB: </span>
                    <span style={{ color: getTier1Color(m.iabTier1) }}>{m.iabTier1}</span>
                    <span className="text-[var(--text-secondary)]"> → </span>
                    <span style={{ color: getTier1Color(m.embeddingCluster) }}>{m.embeddingCluster}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

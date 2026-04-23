import { useState, useMemo, useEffect } from 'react';
import { Network, BookOpen, Loader2 } from 'lucide-react';
import KSlider from './KSlider.jsx';
import KNNForceGraph from './KNNForceGraph.jsx';
import NeighborTable from './NeighborTable.jsx';
import KNNVoteTally from './KNNVoteTally.jsx';
import ScoreComparison from './ScoreComparison.jsx';
import InsightPanel from '../shared/InsightPanel.jsx';
import { findKNN } from '../../lib/knn.js';

export default function KNNPanel({ categories, embedding, scored, inputText }) {
  const [k, setK] = useState(5);
  const [channelNeighbors, setChannelNeighbors] = useState([]);
  const [channelLoading, setChannelLoading] = useState(false);

  // Client-side KNN for IAB categories
  const iabNeighbors = useMemo(() => {
    if (!embedding || !categories.length) return [];
    return findKNN(embedding, categories, k);
  }, [embedding, categories, k]);

  // Server-side KNN for channels
  useEffect(() => {
    if (!embedding) { setChannelNeighbors([]); return; }

    let cancelled = false;
    async function fetchChannelKNN() {
      setChannelLoading(true);
      try {
        const res = await fetch('/api/knn/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embedding, k }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setChannelNeighbors(data.neighbors);
      } catch {
        if (!cancelled) setChannelNeighbors([]);
      } finally {
        if (!cancelled) setChannelLoading(false);
      }
    }
    fetchChannelKNN();
    return () => { cancelled = true; };
  }, [embedding, k]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Network className="w-5 h-5 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold">Load 1: KNN Refinement</h2>
        </div>
        <KSlider k={k} onChange={setK} />
      </div>

      {/* Insight + Blended scoring + Reference pool */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <InsightPanel title="Load 1: Add Empirical Signal" icon={<BookOpen className="w-3.5 h-3.5" />}>
          <p className="mb-1.5">
            Load 1 adds <strong className="text-[var(--text-primary)]">empirical evidence</strong> from previously classified channels. We find the K nearest channels in embedding space and check their assigned categories.
          </p>
          <p>
            This "neighborhood vote" is blended with the Load 0 semantic score to refine ambiguous classifications — what the text <em>means</em> plus what similar channels <em>were classified as</em>.
          </p>
        </InsightPanel>

        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[#475569]/50 p-3">
          <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">Blended Scoring Formula</div>
          <pre className="text-[10px] text-[var(--text-secondary)] font-mono bg-[var(--bg-primary)] rounded p-2 leading-relaxed">
{`L1_score(k) =
  0.75 × L0_score(k)
+ 0.25 × knn_support(k)

knn_support(k) =
  Σ similarity_i
  (for neighbors assigned to k)`}
          </pre>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[#475569]/50 p-3">
          <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">KNN Reference Pool</div>
          <div className="space-y-2 text-[10px] text-[var(--text-secondary)]">
            <p>Only <strong className="text-[var(--text-primary)]">high-confidence</strong> channels qualify for the reference pool:</p>
            <div className="bg-[var(--bg-primary)] rounded p-2 font-mono space-y-0.5">
              <div>top score ≥ 0.75</div>
              <div>score gap ≥ 0.10</div>
              <div>stable across runs</div>
            </div>
            <p>Low-confidence channels are excluded to prevent label drift.</p>
          </div>
        </div>
      </div>

      {/* L0 vs L1 Score Comparison */}
      {channelNeighbors.length > 0 && (
        <ScoreComparison scored={scored} channelNeighbors={channelNeighbors} k={k} />
      )}

      {/* KNN Vote Tally */}
      {iabNeighbors.length > 0 && <KNNVoteTally neighbors={iabNeighbors} />}

      {/* IAB Category KNN */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
            Nearest IAB Categories (K={k})
          </h3>
          <KNNForceGraph
            centerLabel={inputText || 'Your Input'}
            neighbors={iabNeighbors}
            width={480}
            height={420}
          />
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
            IAB Category Neighbors
          </h3>
          <NeighborTable neighbors={iabNeighbors} type="category" />
        </div>
      </div>

      {/* Channel KNN */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
            Nearest Channels (K={k})
            {channelLoading && <Loader2 className="w-3 h-3 animate-spin inline ml-2 text-[var(--accent)]" />}
          </h3>
          {channelNeighbors.length > 0 ? (
            <KNNForceGraph
              centerLabel={inputText || 'Your Input'}
              neighbors={channelNeighbors.map(ch => ({
                ...ch,
                name: ch.title,
                tier1Parent: ch.primaryCategory,
              }))}
              width={480}
              height={420}
            />
          ) : (
            <div className="h-[420px] flex items-center justify-center text-[var(--text-secondary)] text-sm">
              {channelLoading ? 'Loading channel neighbors...' : 'No channel data available'}
            </div>
          )}
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
            Channel Neighbors
          </h3>
          <NeighborTable neighbors={channelNeighbors} type="channel" />
        </div>
      </div>
    </div>
  );
}

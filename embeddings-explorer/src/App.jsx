import { useState, useMemo } from 'react';
import { useIABData } from './hooks/useIABData.js';
import { useEmbedding } from './hooks/useEmbedding.js';
import { useCosineSimilarity } from './hooks/useCosineSimilarity.js';
import { useChannelSample } from './hooks/useChannelSample.js';
import { Box, Compass, Network, Users, GitCompare, Loader2 } from 'lucide-react';

import TextInput from './components/input/TextInput.jsx';
import ExplorerView from './views/ExplorerView.jsx';
import SimilarityView from './views/SimilarityView.jsx';
import KNNView from './views/KNNView.jsx';
import ClusteringView from './views/ClusteringView.jsx';
import ChannelGalaxyView from './views/ChannelGalaxyView.jsx';

const TABS = [
  { id: 'explorer', label: 'Embedding Space', icon: Box },
  { id: 'similarity', label: 'Load 0: Classify', icon: Compass },
  { id: 'knn', label: 'Load 1: KNN Refine', icon: Network },
  { id: 'taxonomy', label: 'Taxonomy Analysis', icon: GitCompare },
  { id: 'galaxy', label: 'Channel Galaxy', icon: Users },
];

export default function App() {
  const { categories, loading: iabLoading, error: iabError } = useIABData();
  const { embedding, loading: embedLoading, latency, error: embedError, embed, clear } = useEmbedding();
  const { channels: channelSample, loading: channelLoading, error: channelError, retry: retryChannels } = useChannelSample();
  const [threshold, setThreshold] = useState(0.3);
  const [activeTab, setActiveTab] = useState('explorer');
  const [inputText, setInputText] = useState('');
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [projection, setProjection] = useState('umap');

  const { scored, assigned, primaryCategory, gapFromFirst, confidenceBucket } = useCosineSimilarity(embedding, categories, threshold);

  const handleAnalyze = async (text) => {
    setInputText(text);
    await embed(text);
  };

  const handleChannelDetail = (channel) => {
    setSelectedChannel(channel);
  };

  const handleClear = () => {
    setInputText('');
    setSelectedChannel(null);
    clear();
  };

  if (iabLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-[var(--accent)] mx-auto mb-4" />
          <p className="text-[var(--text-secondary)] text-lg">Loading 698 IAB categories...</p>
        </div>
      </div>
    );
  }

  if (iabError) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
        <div className="text-center max-w-md">
          <p className="text-[var(--danger)] text-lg mb-2">Failed to load IAB data</p>
          <p className="text-[var(--text-secondary)] text-sm">{iabError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--bg-tertiary)]">
        <div className="flex items-center gap-3">
          <Box className="w-6 h-6 text-[var(--accent)]" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">YouTube Channel Classifier</h1>
            <p className="text-[10px] text-[var(--text-secondary)] leading-tight">
              IAB categorization using embeddings, cosine similarity &amp; KNN
            </p>
          </div>
          <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
            {categories.length} IAB categories
          </span>
        </div>
        {embedding && (
          <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            {latency && (
              <span className="px-2 py-0.5 rounded bg-[var(--bg-tertiary)]">
                Embedding: {latency}ms
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-[var(--bg-tertiary)]">
              Scored: {scored?.length || 0}
            </span>
            <span className="px-2 py-0.5 rounded bg-[var(--bg-tertiary)]">
              Matched: {assigned.length}
            </span>
            {primaryCategory && (
              <span className="flex items-center gap-1.5">
                <span className="text-[var(--accent)] font-medium">{primaryCategory.name}</span>
                <span className="font-mono">({(primaryCategory.similarity * 100).toFixed(1)}%)</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  confidenceBucket === 'strong' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {confidenceBucket === 'strong' ? 'Strong Winner' : 'Multi-label'}
                </span>
              </span>
            )}
          </div>
        )}
      </header>

      {/* Input area */}
      <TextInput
        onAnalyze={handleAnalyze}
        onChannelDetail={handleChannelDetail}
        onClear={handleClear}
        loading={embedLoading}
        error={embedError}
        hasEmbedding={!!embedding}
      />

      {/* Tab bar */}
      <nav className="flex border-b border-[var(--bg-tertiary)] px-6">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* View */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'explorer' && (
          <ExplorerView
            categories={categories}
            embedding={embedding}
            scored={scored}
            assigned={assigned}
            threshold={threshold}
            projection={projection}
            onProjectionChange={setProjection}
            inputText={inputText}
            latency={latency}
          />
        )}
        {activeTab === 'similarity' && (
          <SimilarityView
            categories={categories}
            scored={scored}
            assigned={assigned}
            threshold={threshold}
            onThresholdChange={setThreshold}
            embedding={embedding}
            latency={latency}
            gapFromFirst={gapFromFirst}
            confidenceBucket={confidenceBucket}
            inputText={inputText}
            selectedChannel={selectedChannel}
          />
        )}
        {activeTab === 'knn' && (
          <KNNView
            categories={categories}
            embedding={embedding}
            scored={scored}
            inputText={inputText}
          />
        )}
        {activeTab === 'taxonomy' && (
          <ClusteringView
            categories={categories}
            embedding={embedding}
            scored={scored}
          />
        )}
        {activeTab === 'galaxy' && (
          <ChannelGalaxyView
            categories={categories}
            channelSample={channelSample}
            channelLoading={channelLoading}
            channelError={channelError}
            onRetryChannels={retryChannels}
            embedding={embedding}
            scored={scored}
            assigned={assigned}
            projection={projection}
            onProjectionChange={setProjection}
            inputText={inputText}
          />
        )}
      </main>
    </div>
  );
}

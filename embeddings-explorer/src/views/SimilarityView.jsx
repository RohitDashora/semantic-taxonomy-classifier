import { useState } from 'react';
import { BookOpen, Type, Cpu, BarChart3, Filter, CheckCircle } from 'lucide-react';
import SimilarityBarChart from '../components/charts/SimilarityBarChart.jsx';
import SimilarityHistogram from '../components/charts/SimilarityHistogram.jsx';
import ThresholdSlider from '../components/charts/ThresholdSlider.jsx';
import RadarChart from '../components/charts/RadarChart.jsx';
import CategoryDetail from '../components/charts/CategoryDetail.jsx';
import InsightPanel from '../components/shared/InsightPanel.jsx';
import ClassificationExplainer from '../components/shared/ClassificationExplainer.jsx';

export default function SimilarityView({ categories, scored, assigned, threshold, onThresholdChange, embedding, latency, gapFromFirst, confidenceBucket, inputText, selectedChannel }) {
  const [selectedCategory, setSelectedCategory] = useState(null);

  if (!embedding) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-secondary)]">Search a channel or enter text to run Load 0 classification</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Pipeline step indicator */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {[
          { icon: Type, label: 'Channel Profile', status: 'Done', color: 'text-emerald-400' },
          { icon: Cpu, label: 'Generate Embedding', status: latency ? `${latency}ms · GTE-Large` : 'Done', color: 'text-emerald-400' },
          { icon: BarChart3, label: 'Cosine Similarity', status: `vs ${categories.length} IAB`, color: 'text-emerald-400' },
          { icon: Filter, label: 'Candidate Filter', status: `${assigned.length} passed`, color: assigned.length > 0 ? 'text-emerald-400' : 'text-amber-400' },
          { icon: CheckCircle, label: 'Assign 1–3 Labels', status: scored?.[0] ? scored[0].name : '—', color: 'text-[var(--accent)]' },
        ].map((step, i, arr) => (
          <div key={step.label} className="flex items-center gap-1 flex-shrink-0">
            <div className="bg-[var(--bg-secondary)] border border-[var(--bg-tertiary)] rounded-lg px-3 py-1.5 text-center min-w-[120px]">
              <step.icon className={`w-3.5 h-3.5 mx-auto mb-0.5 ${step.color}`} />
              <div className="text-[10px] text-[var(--text-secondary)]">{step.label}</div>
              <div className={`text-[10px] font-medium ${step.color} truncate`}>{step.status}</div>
            </div>
            {i < arr.length - 1 && (
              <span className="text-[var(--text-secondary)] text-xs mx-0.5">→</span>
            )}
          </div>
        ))}
      </div>

      {/* What the model sees */}
      <ClassificationExplainer inputText={inputText} selectedChannel={selectedChannel} />

      {/* Insight panel */}
      <div className="mb-4">
        <InsightPanel title="Load 0: Semantic Classification" icon={<BookOpen className="w-3.5 h-3.5" />}>
          <p className="mb-1.5">
            Load 0 classifies channels using <strong className="text-[var(--text-primary)]">pure semantic similarity</strong>. We embed the channel profile and compare it against all {categories.length} IAB Content Taxonomy categories using cosine similarity.
          </p>
          <p>
            The closest categories become candidates, filtered by score threshold and gap analysis. If the gap between #1 and #2 is &gt;0.08, we have a <strong className="text-[var(--text-primary)]">strong winner</strong> (1 label). Otherwise, we assign 2–3 labels.
          </p>
        </InsightPanel>
      </div>

      {/* Scoring formula + gap analysis */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-3">
          <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">Load 0 Scoring Formula</div>
          <pre className="text-[10px] text-[var(--text-secondary)] font-mono bg-[var(--bg-primary)] rounded p-2 leading-relaxed">
{`score(k) = cosine(channel_embedding, iab_k_embedding)

Candidates: top 10 by score
Filter:     score ≥ threshold
Output:     1–3 categories based on gap`}
          </pre>
        </div>
        {scored?.length > 0 && (
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-3">
            <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">Gap Analysis</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)]">Best score</span>
                <span className="font-mono text-[var(--accent)]">{(scored[0].similarity * 100).toFixed(1)}%</span>
              </div>
              {scored.length >= 2 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">Gap (#1 → #2)</span>
                  <span className="font-mono text-[var(--text-primary)]">{(gapFromFirst * 100).toFixed(1)}pp</span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)]">Decision</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  confidenceBucket === 'strong'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {confidenceBucket === 'strong' ? 'Strong Winner → 1 label' : 'Multi-label → 2–3 labels'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Threshold slider */}
      <ThresholdSlider
        threshold={threshold}
        onChange={onThresholdChange}
        assignedCount={assigned.length}
      />

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Bar chart — 2 columns */}
        <div className="xl:col-span-2 bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
            Top 30 Categories by Similarity
          </h3>
          <div className="overflow-y-auto max-h-[700px]">
            <SimilarityBarChart
              scored={scored}
              threshold={threshold}
              onCategoryClick={setSelectedCategory}
            />
          </div>
        </div>

        {/* Right column — radar + detail + histogram */}
        <div className="flex flex-col gap-4">
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
              Tier 1 Radar (Max Similarity)
            </h3>
            <RadarChart scored={scored} />
          </div>

          {selectedCategory && (
            <CategoryDetail
              category={selectedCategory}
              onClose={() => setSelectedCategory(null)}
            />
          )}

          {/* Histogram */}
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
              Score Distribution
            </h3>
            <SimilarityHistogram scored={scored} threshold={threshold} />
          </div>
        </div>
      </div>
    </div>
  );
}

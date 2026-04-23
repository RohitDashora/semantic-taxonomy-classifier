import { useMemo } from 'react';
import { computeAllSimilarities } from '../lib/cosine.js';

export function useCosineSimilarity(embedding, categories, threshold = 0.3) {
  const scored = useMemo(() => {
    if (!embedding || !categories.length) return [];
    return computeAllSimilarities(embedding, categories);
  }, [embedding, categories]);

  const assigned = useMemo(() => {
    return scored.filter(c => c.similarity >= threshold).slice(0, 10);
  }, [scored, threshold]);

  const primaryCategory = assigned.length > 0 ? assigned[0] : null;

  const gapFromFirst = assigned.length >= 2
    ? assigned[0].similarity - assigned[1].similarity
    : assigned.length === 1 ? 1 : 0;

  const confidenceBucket = gapFromFirst > 0.08 ? 'strong' : 'moderate';

  return { scored, assigned, primaryCategory, gapFromFirst, confidenceBucket };
}

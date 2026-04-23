/**
 * KNN computation utilities.
 */
import { cosineSimilarity } from './cosine.js';

/**
 * Find K nearest neighbors from a set of items with embeddings.
 */
export function findKNN(queryEmbedding, items, k = 5) {
  const scored = items.map(item => ({
    ...item,
    similarity: cosineSimilarity(queryEmbedding, item.embedding),
    distance: 1 - cosineSimilarity(queryEmbedding, item.embedding),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}

/**
 * Build adjacency data for force-directed graph.
 * Returns { nodes, links } for D3 force simulation.
 */
export function buildForceGraphData(centerLabel, neighbors) {
  const nodes = [
    { id: 'query', label: centerLabel, isCenter: true, similarity: 1.0 },
    ...neighbors.map((n, i) => ({
      id: n.id || `neighbor-${i}`,
      label: n.name || n.title || `#${i + 1}`,
      tier1Parent: n.tier1Parent || n.primaryCategory,
      similarity: n.similarity,
      tierLevel: n.tierLevel,
      isCenter: false,
    })),
  ];

  const links = neighbors.map((n, i) => ({
    source: 'query',
    target: n.id || `neighbor-${i}`,
    similarity: n.similarity,
  }));

  return { nodes, links };
}

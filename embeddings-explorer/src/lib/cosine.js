/**
 * Client-side cosine similarity and vector math.
 * Operates on Float32Arrays or regular arrays.
 */

export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  return normA > 0 && normB > 0 ? dot / (normA * normB) : 0;
}

/**
 * Compute similarity against all categories. Returns sorted array.
 */
export function computeAllSimilarities(embedding, categories) {
  return categories
    .map(cat => ({
      ...cat,
      similarity: cosineSimilarity(embedding, cat.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Find K nearest neighbors from a scored list.
 */
export function knn(scored, k) {
  return scored.slice(0, k);
}

/**
 * Weighted KNN interpolation for 3D positioning.
 * Given K nearest categories with known 3D positions,
 * compute weighted centroid position for a new point.
 */
export function interpolatePosition(scored, k, coordKey) {
  const topK = scored.slice(0, k);
  const totalSim = topK.reduce((s, c) => s + c.similarity, 0);
  if (totalSim === 0) return [0, 0, 0];

  const pos = [0, 0, 0];
  for (const cat of topK) {
    const w = cat.similarity / totalSim;
    const coords = cat[coordKey];
    pos[0] += w * coords[0];
    pos[1] += w * coords[1];
    pos[2] += w * coords[2];
  }
  return pos;
}

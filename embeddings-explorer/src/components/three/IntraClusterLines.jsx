import { useMemo } from 'react';
import * as THREE from 'three';
import { cosineSimilarity } from '../../lib/cosine.js';

export default function IntraClusterLines({ categories, projection, activeCluster }) {
  const lines = useMemo(() => {
    if (activeCluster == null || !categories?.length) return [];

    const coordKey = projection === 'tsne' ? 'tsne' : 'umap';
    const pairs = [];

    // Compute pairwise cosine similarity
    for (let i = 0; i < categories.length; i++) {
      for (let j = i + 1; j < categories.length; j++) {
        const sim = cosineSimilarity(categories[i].embedding, categories[j].embedding);
        if (sim > 0.5) {
          pairs.push({ i, j, sim });
        }
      }
    }

    // Sort by similarity descending and cap at 50
    pairs.sort((a, b) => b.sim - a.sim);
    const top = pairs.slice(0, 50);

    return top.map(({ i, j, sim }) => {
      const posA = categories[i][coordKey];
      const posB = categories[j][coordKey];
      const points = [
        new THREE.Vector3(posA[0], posA[1], posA[2]),
        new THREE.Vector3(posB[0], posB[1], posB[2]),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);

      // Color: blue (0.5 sim) → green (0.8+)
      const t = Math.min(1, (sim - 0.5) / 0.3);
      const color = new THREE.Color('#3b82f6').lerp(new THREE.Color('#22c55e'), t);

      return { geometry, sim, color: `#${color.getHexString()}`, opacity: 0.3 + sim * 0.5 };
    });
  }, [categories, projection, activeCluster]);

  if (!lines.length) return null;

  return (
    <group>
      {lines.map((line, i) => (
        <line key={i} geometry={line.geometry}>
          <lineBasicMaterial
            color={line.color}
            opacity={line.opacity}
            transparent
            linewidth={1}
          />
        </line>
      ))}
    </group>
  );
}

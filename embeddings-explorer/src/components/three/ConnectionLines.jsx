import { useMemo } from 'react';
import * as THREE from 'three';
import { interpolatePosition } from '../../lib/cosine.js';

export default function ConnectionLines({ scored, assigned, projection }) {
  const coordKey = projection === 'tsne' ? 'tsne' : 'umap';
  const userPos = useMemo(() => {
    if (!scored || scored.length === 0) return [0, 0, 0];
    return interpolatePosition(scored, 5, coordKey);
  }, [scored, coordKey]);

  const lines = useMemo(() => {
    if (!assigned) return [];
    return assigned.map(cat => {
      const catPos = cat[coordKey];
      if (!catPos) return null;
      const points = [
        new THREE.Vector3(userPos[0], userPos[1], userPos[2]),
        new THREE.Vector3(catPos[0], catPos[1], catPos[2]),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      return { geometry, similarity: cat.similarity, name: cat.name };
    }).filter(Boolean);
  }, [assigned, userPos, coordKey]);

  return (
    <group>
      {lines.map((line, i) => (
        <line key={i} geometry={line.geometry}>
          <lineBasicMaterial
            color={line.similarity > 0.5 ? '#22c55e' : '#3b82f6'}
            opacity={Math.max(0.3, line.similarity)}
            transparent
            linewidth={1}
          />
        </line>
      ))}
    </group>
  );
}

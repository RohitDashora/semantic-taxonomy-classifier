import { useMemo } from 'react';
import * as THREE from 'three';
import { getTier1Color } from '../../lib/colors.js';

/**
 * Draws edges from a Tier 1 category anchor point to filtered channels.
 * Shows connectivity between the category and the channels classified under it.
 */
export default function CategoryChannelEdges({ categoryAnchor, channels, projection, maxEdges = 200 }) {
  const coordKey = projection === 'tsne' ? 'tsne' : 'umap';

  const { lines, color } = useMemo(() => {
    if (!categoryAnchor || !channels?.length) return { lines: [], color: '#3b82f6' };

    const anchorPos = categoryAnchor[coordKey];
    if (!anchorPos) return { lines: [], color: '#3b82f6' };

    const col = getTier1Color(categoryAnchor.tier1Parent || categoryAnchor.name);

    // Sort by confidence descending, take top N
    const sorted = [...channels]
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, maxEdges);

    const result = sorted.map(ch => {
      const chPos = ch[coordKey];
      if (!chPos || !Array.isArray(chPos)) return null;

      const points = [
        new THREE.Vector3(anchorPos[0], anchorPos[1], anchorPos[2]),
        new THREE.Vector3(chPos[0], chPos[1], chPos[2]),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      return { geometry, confidence: ch.confidence || 0 };
    }).filter(Boolean);

    return { lines: result, color: col };
  }, [categoryAnchor, channels, coordKey, maxEdges]);

  if (lines.length === 0) return null;

  return (
    <group>
      {lines.map((line, i) => (
        <line key={i} geometry={line.geometry}>
          <lineBasicMaterial
            color={color}
            opacity={0.08 + line.confidence * 0.25}
            transparent
            linewidth={1}
          />
        </line>
      ))}
    </group>
  );
}

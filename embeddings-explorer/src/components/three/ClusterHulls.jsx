import { useMemo } from 'react';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { getTier1Color } from '../../lib/colors.js';

export default function ClusterHulls({ categories, projection, clusterType, highlightCluster }) {
  const hulls = useMemo(() => {
    const coordKey = projection === 'tsne' ? 'tsne' : 'umap';

    // Group categories by cluster
    const groups = new Map();
    categories.forEach(cat => {
      let key;
      if (clusterType === 'tier1') {
        key = cat.tier1Parent;
      } else if (clusterType === 'kmeans') {
        key = cat.clusterKmeans;
      } else {
        key = cat.clusterHdbscan;
      }
      if (key === -1) return; // skip noise
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cat);
    });

    const result = [];
    groups.forEach((cats, key) => {
      if (cats.length < 4) return; // need at least 4 points for convex hull

      const points = cats
        .map(c => {
          const pos = c[coordKey];
          if (!pos) return null;
          return new THREE.Vector3(pos[0], pos[1], pos[2]);
        })
        .filter(Boolean);

      try {
        const geometry = new ConvexGeometry(points);
        const color = clusterType === 'tier1'
          ? getTier1Color(key)
          : getTier1Color(cats[0]?.tier1Parent || 'Unknown');
        const isHighlighted = highlightCluster === null || highlightCluster === undefined || highlightCluster === key;

        result.push({ geometry, color, key, isHighlighted });
      } catch {
        // ConvexGeometry can fail for degenerate point sets
      }
    });

    return result;
  }, [categories, projection, clusterType, highlightCluster]);

  return (
    <group>
      {hulls.map(hull => (
        <mesh key={String(hull.key)} geometry={hull.geometry}>
          <meshBasicMaterial
            color={hull.color}
            transparent
            opacity={hull.isHighlighted ? 0.12 : 0.04}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { getTier1Color } from '../../lib/colors.js';

export default function LODLabels({ categories, projection }) {
  const groupRef = useRef();
  const { camera } = useThree();

  // Only render labels for categories based on zoom distance
  const visibleCategories = useVisibleCategories(categories, camera, projection);

  return (
    <group ref={groupRef}>
      {visibleCategories.map(cat => {
        const pos = projection === 'tsne' ? cat.tsne : cat.umap;
        if (!pos) return null;
        return (
          <Html
            key={cat.id}
            position={[pos[0], pos[1] + 1.5, pos[2]]}
            distanceFactor={50}
            center
            style={{ pointerEvents: 'none' }}
          >
            <div
              className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
              style={{
                color: getTier1Color(cat.tier1Parent),
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                borderLeft: `2px solid ${getTier1Color(cat.tier1Parent)}`,
              }}
            >
              {cat.name}
            </div>
          </Html>
        );
      })}
    </group>
  );
}

function useVisibleCategories(categories, camera, projection) {
  const ref = useRef([]);

  useFrame(() => {
    const dist = camera.position.length();

    let filtered;
    if (dist > 150) {
      filtered = categories.filter(c => c.tierLevel === 1);
    } else if (dist > 80) {
      filtered = categories.filter(c => c.tierLevel <= 2);
    } else {
      const target = camera.position.clone().normalize().multiplyScalar(dist * 0.5);
      filtered = categories.filter(c => {
        if (c.tierLevel === 1) return true;
        const pos = projection === 'tsne' ? c.tsne : c.umap;
        if (!pos) return false;
        const dx = pos[0] - target.x;
        const dy = pos[1] - target.y;
        const dz = pos[2] - target.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) < 40;
      });
    }

    // Cap at 60 labels for performance
    ref.current = filtered.slice(0, 60);
  });

  return ref.current;
}

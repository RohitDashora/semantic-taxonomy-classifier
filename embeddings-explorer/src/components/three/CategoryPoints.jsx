import { useRef, useMemo, useCallback, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { getTier1Color } from '../../lib/colors.js';

export default function CategoryPoints({
  categories, projection, onSelect, selectedId,
}) {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const tmpWhite = useMemo(() => new THREE.Color('#ffffff'), []);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const prevHoveredRef = useRef(null);
  const prevSelectedRef = useRef(null);
  const initializedRef = useRef(false);

  const { positions, colors, sizes } = useMemo(() => {
    initializedRef.current = false; // force re-render when data changes
    const pos = [];
    const col = [];
    const sz = [];

    categories.forEach(cat => {
      pos.push(projection === 'tsne' ? cat.tsne : cat.umap);
      col.push(new THREE.Color(getTier1Color(cat.tier1Parent)));
      sz.push(cat.tierLevel === 1 ? 1.3 : cat.tierLevel === 2 ? 0.9 : 0.6);
    });

    return { positions: pos, colors: col, sizes: sz };
  }, [categories, projection]);

  const selectedIdx = useMemo(() => {
    if (!selectedId) return null;
    return categories.findIndex(c => c.id === selectedId);
  }, [categories, selectedId]);

  const handlePointerOver = useCallback((e) => {
    e.stopPropagation();
    setHoveredIdx(e.instanceId);
    document.body.style.cursor = 'pointer';
  }, []);

  const handlePointerOut = useCallback(() => {
    setHoveredIdx(null);
    document.body.style.cursor = 'auto';
  }, []);

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    const idx = e.instanceId;
    if (idx != null && categories[idx]) {
      onSelect?.(categories[idx]);
    }
  }, [categories, onSelect]);

  useFrame(() => {
    if (!meshRef.current) return;

    // Skip update if nothing changed since last frame
    const dirty = !initializedRef.current ||
      prevHoveredRef.current !== hoveredIdx ||
      prevSelectedRef.current !== selectedIdx;
    if (!dirty) return;

    prevHoveredRef.current = hoveredIdx;
    prevSelectedRef.current = selectedIdx;
    initializedRef.current = true;

    categories.forEach((cat, i) => {
      const coords = positions[i];
      if (!coords) return;
      dummy.position.set(coords[0], coords[1], coords[2]);

      let scale = sizes[i];
      tmpColor.copy(colors[i]);

      if (i === hoveredIdx) {
        scale *= 2.5;
        tmpColor.lerp(tmpWhite, 0.4);
      } else if (i === selectedIdx) {
        scale *= 2.0;
        tmpColor.lerp(tmpWhite, 0.3);
      }

      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      meshRef.current.setColorAt(i, tmpColor);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  const hoveredCat = hoveredIdx != null ? categories[hoveredIdx] : null;
  const hoveredPos = hoveredIdx != null ? positions[hoveredIdx] : null;

  return (
    <>
      <instancedMesh
        ref={meshRef}
        key={categories.length}
        args={[null, null, categories.length]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial toneMapped={false}>
          <color attach="color" args={[1.5, 1.5, 1.5]} />
        </meshBasicMaterial>
      </instancedMesh>

      {hoveredCat && hoveredPos && (
        <Html
          position={[hoveredPos[0], hoveredPos[1] + 3, hoveredPos[2]]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-[#0f172a]/95 backdrop-blur border border-[#334155] rounded-lg px-3 py-2 shadow-xl min-w-[180px]">
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: getTier1Color(hoveredCat.tier1Parent) }}
              />
              <span className="text-white text-xs font-semibold truncate">
                {hoveredCat.name}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mb-1">{hoveredCat.tierPath}</div>
          </div>
        </Html>
      )}
    </>
  );
}

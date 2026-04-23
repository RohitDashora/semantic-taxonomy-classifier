import { useRef, useMemo, useCallback, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { getTier1Color } from '../../lib/colors.js';

export default function ChannelGalaxy({ channels, projection, baseScale = 0.35, hoverScale = 0.8, opacity = 0.35 }) {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const prevHoveredRef = useRef(null);
  const initializedRef = useRef(false);

  const { validChannels, positions, colors } = useMemo(() => {
    initializedRef.current = false; // force re-render when data changes
    const valid = [];
    const pos = [];
    const col = [];
    channels.forEach(ch => {
      const coords = projection === 'tsne' ? ch.tsne : ch.umap;
      if (!coords || !Array.isArray(coords)) return;
      valid.push(ch);
      pos.push(coords);
      col.push(new THREE.Color(getTier1Color(ch.primaryCategory) || '#4a5568'));
    });
    return { validChannels: valid, positions: pos, colors: col };
  }, [channels, projection]);

  const handlePointerOver = useCallback((e) => {
    e.stopPropagation();
    setHoveredIdx(e.instanceId);
    document.body.style.cursor = 'pointer';
  }, []);

  const handlePointerOut = useCallback(() => {
    setHoveredIdx(null);
    document.body.style.cursor = 'auto';
  }, []);

  useFrame(() => {
    if (!meshRef.current) return;

    const dirty = !initializedRef.current || prevHoveredRef.current !== hoveredIdx;
    if (!dirty) return;

    prevHoveredRef.current = hoveredIdx;
    initializedRef.current = true;

    validChannels.forEach((ch, i) => {
      const coords = positions[i];
      dummy.position.set(coords[0], coords[1], coords[2]);
      dummy.scale.setScalar(i === hoveredIdx ? hoverScale : baseScale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      meshRef.current.setColorAt(i, colors[i]);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  const hoveredCh = hoveredIdx != null ? validChannels[hoveredIdx] : null;
  const hoveredPos = hoveredIdx != null ? positions[hoveredIdx] : null;

  return (
    <>
      <instancedMesh
        ref={meshRef}
        key={validChannels.length}
        args={[null, null, validChannels.length]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial transparent opacity={opacity} toneMapped={false} />
      </instancedMesh>

      {hoveredCh && hoveredPos && (
        <Html
          position={[hoveredPos[0], hoveredPos[1] + 2, hoveredPos[2]]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-[#0f172a]/95 backdrop-blur border border-[#334155] rounded-lg px-3 py-2 shadow-xl min-w-[160px]">
            <div className="text-white text-xs font-semibold truncate">{hoveredCh.title}</div>
            <div className="text-[10px] text-slate-400">
              {hoveredCh.primaryCategory} — {(hoveredCh.confidence * 100).toFixed(0)}%
            </div>
          </div>
        </Html>
      )}
    </>
  );
}

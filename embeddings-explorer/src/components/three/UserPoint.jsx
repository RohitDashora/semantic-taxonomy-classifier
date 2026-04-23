import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { interpolatePosition } from '../../lib/cosine.js';

export default function UserPoint({ scored, projection }) {
  const meshRef = useRef();
  const glowRef = useRef();

  const position = useMemo(() => {
    if (!scored || scored.length === 0) return [0, 0, 0];
    const coordKey = projection === 'tsne' ? 'tsne' : 'umap';
    return interpolatePosition(scored, 5, coordKey);
  }, [scored, projection]);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      const t = clock.getElapsedTime();
      const scale = 2.0 + Math.sin(t * 2) * 0.3;
      meshRef.current.scale.setScalar(scale);
    }
    if (glowRef.current) {
      const t = clock.getElapsedTime();
      glowRef.current.scale.setScalar(2.5 + Math.sin(t * 1.5) * 0.5);
      glowRef.current.material.opacity = 0.15 + Math.sin(t * 2) * 0.05;
    }
  });

  return (
    <group position={position}>
      {/* Glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.15} />
      </mesh>

      {/* Core star */}
      <mesh ref={meshRef}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#f59e0b"
          emissiveIntensity={1.2}
          toneMapped={false}
        />
      </mesh>

      {/* Label */}
      <Html distanceFactor={50} center style={{ pointerEvents: 'none' }}>
        <div className="bg-amber-500/90 text-black text-xs font-bold px-2 py-1 rounded whitespace-nowrap -translate-y-6">
          Your Input
        </div>
      </Html>
    </group>
  );
}

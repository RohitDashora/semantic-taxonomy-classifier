import { useRef, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import ChannelGalaxy from './ChannelGalaxy.jsx';
import CategoryPoints from './CategoryPoints.jsx';
import CategoryChannelEdges from './CategoryChannelEdges.jsx';
import LODLabels from './LODLabels.jsx';
import UserPoint from './UserPoint.jsx';
import CameraController from './CameraController.jsx';

export default function GalaxyScene({
  categories,
  channelSample,
  projection,
  embedding,
  scored,
  focusTarget,
  filterCategory,
}) {
  const controlsRef = useRef();

  // Show only Tier 1 categories as anchor points (26 max)
  const tier1Categories = useMemo(() => {
    return categories.filter(c => c.tierLevel === 1);
  }, [categories]);

  // Find the anchor category for the active filter
  const filterAnchor = useMemo(() => {
    if (!filterCategory) return null;
    return tier1Categories.find(c => c.tier1Parent === filterCategory || c.name === filterCategory);
  }, [tier1Categories, filterCategory]);

  return (
    <Canvas
      className="three-canvas"
      camera={{ position: [50, 35, 50], fov: 60, near: 0.1, far: 500 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#050a18']} />
      <ambientLight intensity={0.7} />
      <pointLight position={[100, 100, 100]} intensity={1.2} />
      <pointLight position={[-80, 50, -80]} intensity={0.4} color="#6366f1" />
      <Stars radius={200} depth={100} count={2000} factor={3} saturation={0} />

      {/* PRIMARY: 5000 channels */}
      {channelSample?.length > 0 && (
        <ChannelGalaxy
          channels={channelSample}
          projection={projection}
          baseScale={0.7}
          hoverScale={1.2}
          opacity={0.55}
        />
      )}

      {/* Edges from category anchor to channels when filtered */}
      {filterAnchor && channelSample?.length > 0 && (
        <CategoryChannelEdges
          categoryAnchor={filterAnchor}
          channels={channelSample}
          projection={projection}
        />
      )}

      {/* SECONDARY: Tier 1 category anchors */}
      <CategoryPoints
        categories={tier1Categories}
        projection={projection}
        onSelect={() => {}}
        selectedId={null}
      />

      <LODLabels categories={tier1Categories} projection={projection} />

      {/* User point when classified */}
      {embedding && scored?.length > 0 && (
        <UserPoint scored={scored} projection={projection} />
      )}

      <CameraController focusTarget={focusTarget} controlsRef={controlsRef} />

      <OrbitControls
        ref={controlsRef}
        enablePan
        enableZoom
        enableRotate
        zoomSpeed={0.8}
        rotateSpeed={0.5}
        minDistance={10}
        maxDistance={250}
      />

      <EffectComposer>
        <Bloom
          intensity={0.8}
          luminanceThreshold={0.5}
          luminanceSmoothing={0.9}
          mipmapBlur
          radius={0.3}
        />
      </EffectComposer>
    </Canvas>
  );
}

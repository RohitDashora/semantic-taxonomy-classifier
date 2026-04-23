import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import CategoryPoints from './CategoryPoints.jsx';
import UserPoint from './UserPoint.jsx';
import ConnectionLines from './ConnectionLines.jsx';
import ClusterHulls from './ClusterHulls.jsx';
import LODLabels from './LODLabels.jsx';
import CameraController from './CameraController.jsx';
import IntraClusterLines from './IntraClusterLines.jsx';

export default function EmbeddingScene({
  categories,
  displayCategories,
  projection,
  embedding,
  scored,
  assigned,
  showClusters,
  clusterType,
  highlightCluster,
  onSelectCategory,
  selectedCategory,
  focusTarget,
  selectedCluster,
  clusterMembers,
}) {
  const controlsRef = useRef();

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

      <CategoryPoints
        categories={displayCategories}
        projection={projection}
        onSelect={onSelectCategory}
        selectedId={selectedCategory?.id}
      />

      <LODLabels categories={displayCategories} projection={projection} />

      {showClusters && (displayCategories.length === categories.length || selectedCluster != null) && (
        <ClusterHulls
          categories={categories}
          projection={projection}
          clusterType={clusterType}
          highlightCluster={highlightCluster}
        />
      )}

      {selectedCluster != null && clusterMembers?.length > 0 && (
        <IntraClusterLines
          categories={clusterMembers}
          projection={projection}
          activeCluster={selectedCluster}
        />
      )}

      {embedding && assigned.length > 0 && (
        <>
          <UserPoint scored={scored} projection={projection} />
          <ConnectionLines
            scored={scored}
            assigned={assigned}
            projection={projection}
          />
        </>
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

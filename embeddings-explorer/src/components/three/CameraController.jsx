import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Smoothly animates the camera to focus on a target position.
 * When focusTarget changes, lerps the camera toward it over ~1s.
 */
export default function CameraController({ focusTarget, controlsRef }) {
  const { camera } = useThree();
  const isAnimating = useRef(false);
  const targetPos = useRef(new THREE.Vector3());
  const targetLookAt = useRef(new THREE.Vector3());
  const progress = useRef(0);

  useFrame((_, delta) => {
    if (!focusTarget) {
      isAnimating.current = false;
      return;
    }

    // New target arrived
    if (!isAnimating.current) {
      isAnimating.current = true;
      progress.current = 0;
      targetLookAt.current.set(focusTarget[0], focusTarget[1], focusTarget[2]);

      // Position camera at an offset from the target
      const offset = new THREE.Vector3(20, 15, 20);
      targetPos.current.copy(targetLookAt.current).add(offset);
    }

    progress.current = Math.min(progress.current + delta * 1.8, 1);
    const t = easeInOutCubic(progress.current);

    camera.position.lerp(targetPos.current, t * 0.08);

    // Update orbit controls target
    if (controlsRef?.current) {
      controlsRef.current.target.lerp(targetLookAt.current, t * 0.08);
      controlsRef.current.update();
    }

    if (progress.current >= 1) {
      isAnimating.current = false;
    }
  });

  return null;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

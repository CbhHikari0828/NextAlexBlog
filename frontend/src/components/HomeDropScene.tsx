import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function FallingPolyhedron() {
  const groupRef = useRef<THREE.Group>(null);
  const shellGeometry = useMemo(() => new THREE.IcosahedronGeometry(1.28, 0), []);
  const edgeGeometry = useMemo(() => new THREE.EdgesGeometry(shellGeometry), [shellGeometry]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.x += delta * 0.42;
    groupRef.current.rotation.y += delta * 0.58;
    groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.8) * 0.08;
  });

  return (
    <group ref={groupRef}>
      <pointLight color="#1677ff" intensity={24} distance={4.6} position={[0.1, 0.1, 0.3]} />
      <mesh geometry={shellGeometry}>
        <meshPhysicalMaterial color="#dff0ff" transparent opacity={0.3} roughness={0.16} metalness={0.04} transmission={0.48} thickness={0.42} />
      </mesh>
      <lineSegments geometry={edgeGeometry}>
        <lineBasicMaterial color="#6fbaff" transparent opacity={0.92} />
      </lineSegments>
      <mesh scale={0.34}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color="#1677ff" transparent opacity={0.94} />
      </mesh>
    </group>
  );
}

export default function HomeDropScene() {
  return (
    <Canvas className="home-drop-canvas" camera={{ position: [0, 0, 4.6], fov: 42 }} dpr={[1, 1.8]} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}>
      <ambientLight intensity={1.2} />
      <directionalLight color="#ffffff" intensity={1.8} position={[2.5, 3, 4]} />
      <FallingPolyhedron />
    </Canvas>
  );
}

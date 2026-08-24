import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function FallingPolyhedron() {
  const groupRef = useRef<THREE.Group>(null);
  const polyhedronRef = useRef<THREE.Group>(null);
  const cubeRef = useRef<THREE.Group>(null);
  const morphProgressRef = useRef(0);
  const visualScaleRef = useRef(1);
  const shellGlassMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const shellMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const edgeMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const coreMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const glowMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const cubeShellMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const cubeEdgeMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const cubeCoreMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const cubeGlowMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const cubeLidMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const cubeHighlightMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const shellGeometry = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(1.36, 2);
    const position = geometry.attributes.position;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const wave = 1 + Math.sin(x * 2.1 + y * 1.6) * 0.08 + Math.cos(z * 2.7 - x) * 0.06;

      position.setXYZ(i, x * wave * 1.08, y * wave * 0.94, z * wave * 0.82);
    }

    geometry.computeVertexNormals();
    return geometry;
  }, []);
  const edgeGeometry = useMemo(() => new THREE.EdgesGeometry(shellGeometry), [shellGeometry]);
  const cubeGeometry = useMemo(() => new THREE.BoxGeometry(2.18, 2.18, 2.18, 3, 3, 3), []);
  const cubeEdgeGeometry = useMemo(() => new THREE.EdgesGeometry(cubeGeometry), [cubeGeometry]);
  const cubeCoreGeometry = useMemo(() => new THREE.BoxGeometry(1.42, 1.42, 1.42, 2, 2, 2), []);
  const cubeLidGeometry = useMemo(() => new THREE.BoxGeometry(1.48, 0.16, 1.48, 1, 1, 1), []);
  const cubeHighlightGeometry = useMemo(() => new THREE.PlaneGeometry(1.05, 0.12), []);
  const coreGeometry = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(1.04, 2);
    const position = geometry.attributes.position;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const wave = 1 + Math.sin(y * 3.2 + z * 1.8) * 0.14 + Math.cos(x * 2.4 - z * 1.2) * 0.1;

      position.setXYZ(i, x * wave * 0.96, y * wave * 0.82, z * wave * 0.7);
    }

    geometry.computeVertexNormals();
    return geometry;
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const rawMorphProgress = typeof document === "undefined"
      ? 0
      : Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".home-drop-visual") ?? document.documentElement).getPropertyValue("--drop-cube-progress"));
    const rawVisualScale = typeof document === "undefined"
      ? 1
      : Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".home-drop-visual") ?? document.documentElement).getPropertyValue("--drop-visual-scale"));
    const targetMorphProgress = THREE.MathUtils.clamp(Number.isFinite(rawMorphProgress) ? rawMorphProgress : 0, 0, 1);
    const targetVisualScale = THREE.MathUtils.clamp(Number.isFinite(rawVisualScale) ? rawVisualScale : 1, 0.5, 1);
    morphProgressRef.current = THREE.MathUtils.lerp(morphProgressRef.current, targetMorphProgress, Math.min(1, delta * 7.2));
    visualScaleRef.current = THREE.MathUtils.lerp(visualScaleRef.current, targetVisualScale, Math.min(1, delta * 8.6));
    const morphProgress = morphProgressRef.current * morphProgressRef.current * (3 - 2 * morphProgressRef.current);
    const polyOpacity = 1 - morphProgress;
    const cubeOpacity = morphProgress;

    groupRef.current.position.x = morphProgress * 0.11;
    groupRef.current.scale.setScalar(visualScaleRef.current);
    groupRef.current.rotation.x += delta * (0.42 + morphProgress * 0.2);
    groupRef.current.rotation.y += delta * (0.58 + morphProgress * 0.18);
    groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.8) * 0.08 + morphProgress * 0.16;

    if (polyhedronRef.current) {
      polyhedronRef.current.visible = polyOpacity > 0.01;
      polyhedronRef.current.scale.setScalar(1 - morphProgress * 0.16);
      polyhedronRef.current.rotation.x = morphProgress * 0.24;
      polyhedronRef.current.rotation.y = -morphProgress * 0.18;
    }

    if (cubeRef.current) {
      cubeRef.current.visible = cubeOpacity > 0.01;
      cubeRef.current.position.x = 0;
      cubeRef.current.position.y = morphProgress * -0.02;
      cubeRef.current.scale.setScalar(0.82 + morphProgress * 0.18);
      cubeRef.current.rotation.x = -0.48 + (1 - morphProgress) * -0.18;
      cubeRef.current.rotation.y = 0.62 + (1 - morphProgress) * 0.18;
      cubeRef.current.rotation.z = -0.12 + Math.sin(state.clock.elapsedTime * 0.9) * 0.03;
    }

    if (shellGlassMaterialRef.current) shellGlassMaterialRef.current.opacity = 0.18 * polyOpacity;
    if (shellMaterialRef.current) shellMaterialRef.current.opacity = 0.48 * polyOpacity;
    if (edgeMaterialRef.current) edgeMaterialRef.current.opacity = 0.34 * polyOpacity;
    if (coreMaterialRef.current) coreMaterialRef.current.opacity = 0.92 * polyOpacity;
    if (glowMaterialRef.current) glowMaterialRef.current.opacity = 0.42 * polyOpacity;
    if (cubeShellMaterialRef.current) cubeShellMaterialRef.current.opacity = 0.22 * cubeOpacity;
    if (cubeEdgeMaterialRef.current) cubeEdgeMaterialRef.current.opacity = 0.05 * cubeOpacity;
    if (cubeCoreMaterialRef.current) cubeCoreMaterialRef.current.opacity = cubeOpacity;
    if (cubeGlowMaterialRef.current) cubeGlowMaterialRef.current.opacity = 0.16 * cubeOpacity;
    if (cubeLidMaterialRef.current) cubeLidMaterialRef.current.opacity = 0.82 * cubeOpacity;
    if (cubeHighlightMaterialRef.current) cubeHighlightMaterialRef.current.opacity = 0.18 * cubeOpacity;
  });

  return (
    <group ref={groupRef}>
      <pointLight color="#38bdf8" intensity={44} distance={5.2} position={[0.1, 0.05, 0.42]} />
      <pointLight color="#ffffff" intensity={11} distance={4.8} position={[-1.4, 1.3, 1.8]} />
      <spotLight color="#ffffff" intensity={4.2} distance={7.5} angle={0.42} penumbra={0.86} position={[-2.2, 2.8, 3.4]} />
      <directionalLight color="#e0f7ff" intensity={1.05} position={[-3.2, 2.2, 2.7]} />
      <group ref={polyhedronRef}>
        <mesh geometry={shellGeometry} scale={1.08}>
          <meshPhysicalMaterial ref={shellGlassMaterialRef} color="#eef1ef" transparent opacity={0.18} roughness={0.18} metalness={0.04} clearcoat={0.32} clearcoatRoughness={0.34} reflectivity={0.28} transmission={0.18} thickness={0.84} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh geometry={shellGeometry}>
          <meshPhysicalMaterial ref={shellMaterialRef} color="#d9dfde" transparent opacity={0.48} roughness={0.22} metalness={0.05} clearcoat={0.28} clearcoatRoughness={0.38} reflectivity={0.26} transmission={0.24} thickness={0.9} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial ref={edgeMaterialRef} color="#f2f4f2" transparent opacity={0.34} />
        </lineSegments>
        <mesh geometry={coreGeometry} scale={0.9} rotation={[0.18, -0.3, 0.1]}>
          <meshPhysicalMaterial ref={coreMaterialRef} color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.68} roughness={0.48} metalness={0.08} clearcoat={0.22} clearcoatRoughness={0.46} reflectivity={0.22} transparent opacity={0.92} />
        </mesh>
        <mesh geometry={coreGeometry} scale={0.58} rotation={[-0.12, 0.5, -0.08]}>
          <meshBasicMaterial ref={glowMaterialRef} color="#7dd3fc" transparent opacity={0.42} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <group ref={cubeRef} visible={false}>
        <mesh geometry={cubeGeometry} scale={[1.22, 1.22, 1.22]} rotation={[0.04, -0.05, 0.02]}>
          <meshPhysicalMaterial ref={cubeShellMaterialRef} color="#e5edf1" transparent opacity={0} roughness={0.18} metalness={0.04} clearcoat={0.38} clearcoatRoughness={0.32} reflectivity={0.32} transmission={0.18} thickness={1.08} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <lineSegments geometry={cubeEdgeGeometry}>
          <lineBasicMaterial ref={cubeEdgeMaterialRef} color="#f5fcff" transparent opacity={0} />
        </lineSegments>
        <mesh geometry={cubeCoreGeometry} position={[0.18, -0.26, 0.1]} rotation={[0.02, -0.04, 0.01]}>
          <meshPhysicalMaterial ref={cubeCoreMaterialRef} color="#0284c7" emissive="#0ea5e9" emissiveIntensity={0.22} roughness={0.34} metalness={0.1} clearcoat={0.34} clearcoatRoughness={0.28} reflectivity={0.3} transparent opacity={0} />
        </mesh>
        <mesh geometry={cubeLidGeometry} scale={[1.08, 1, 1.08]} position={[-0.42, 1.42, 0.16]} rotation={[0.05, -0.08, -0.04]}>
          <meshPhysicalMaterial ref={cubeLidMaterialRef} color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={0.38} roughness={0.26} metalness={0.08} clearcoat={0.3} clearcoatRoughness={0.3} reflectivity={0.28} transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh geometry={cubeHighlightGeometry} position={[0.01, 0.34, 1.02]} rotation={[0.18, 0.04, -0.5]}>
          <meshBasicMaterial ref={cubeHighlightMaterialRef} color="#ffffff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh geometry={cubeCoreGeometry} scale={[0.5, 0.5, 0.5]} position={[0.18, -0.26, 0.1]}>
          <meshBasicMaterial ref={cubeGlowMaterialRef} color="#7dd3fc" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

export default function HomeDropScene() {
  return (
    <Canvas className="home-drop-canvas" camera={{ position: [0, 0, 4.6], fov: 42 }} dpr={[1, 1.8]} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}>
      <ambientLight intensity={1.8} />
      <directionalLight color="#ffffff" intensity={2.1} position={[2.5, 3, 4]} />
      <FallingPolyhedron />
    </Canvas>
  );
}

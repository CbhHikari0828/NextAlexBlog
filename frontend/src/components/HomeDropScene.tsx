import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function FallingPolyhedron() {
  const groupRef = useRef<THREE.Group>(null);
  const polyhedronRef = useRef<THREE.Group>(null);
  const polyCoreGroupRef = useRef<THREE.Group>(null);
  const cubeRef = useRef<THREE.Group>(null);
  const cubeCoreGroupRef = useRef<THREE.Group>(null);
  const morphProgressRef = useRef(0);
  const travelProgressRef = useRef(0);
  const visualScaleRef = useRef(1);
  const spinRef = useRef(0);
  const edgeMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const coreMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const cubeShellMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const cubeEdgeMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const cubeCoreMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
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

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const dropStyle = typeof document === "undefined"
      ? undefined
      : getComputedStyle(document.querySelector<HTMLElement>(".home-drop-visual") ?? document.documentElement);
    const rawMorphProgress = Number.parseFloat(dropStyle?.getPropertyValue("--drop-cube-progress") ?? "0");
    const rawVisualScale = Number.parseFloat(dropStyle?.getPropertyValue("--drop-visual-scale") ?? "1");
    const rawTravelProgress = Number.parseFloat(dropStyle?.getPropertyValue("--drop-travel-progress") ?? "0");
    const targetMorphProgress = THREE.MathUtils.clamp(Number.isFinite(rawMorphProgress) ? rawMorphProgress : 0, 0, 1);
    const targetVisualScale = THREE.MathUtils.clamp(Number.isFinite(rawVisualScale) ? rawVisualScale : 1, 0.5, 1);
    const targetTravelProgress = THREE.MathUtils.clamp(Number.isFinite(rawTravelProgress) ? rawTravelProgress : 0, 0, 1);

    morphProgressRef.current = THREE.MathUtils.damp(morphProgressRef.current, targetMorphProgress, 13, delta);
    travelProgressRef.current = THREE.MathUtils.damp(travelProgressRef.current, targetTravelProgress, 12, delta);
    visualScaleRef.current = THREE.MathUtils.damp(visualScaleRef.current, targetVisualScale, 14, delta);

    if (Math.abs(morphProgressRef.current - targetMorphProgress) < 0.001) morphProgressRef.current = targetMorphProgress;
    if (Math.abs(travelProgressRef.current - targetTravelProgress) < 0.001) travelProgressRef.current = targetTravelProgress;
    if (Math.abs(visualScaleRef.current - targetVisualScale) < 0.001) visualScaleRef.current = targetVisualScale;

    spinRef.current = (spinRef.current + delta * (0.34 + targetTravelProgress * 0.12)) % (Math.PI * 2);

    const morphProgress = morphProgressRef.current * morphProgressRef.current * (3 - 2 * morphProgressRef.current);
    const travelProgress = travelProgressRef.current;
    const spin = spinRef.current;
    const polyOpacity = 1 - morphProgress;
    const polyShellOpacity = Math.pow(polyOpacity, 1.85);
    const polyCoreOpacity = Math.pow(polyOpacity, 1.18);
    const cubeOpacity = morphProgress;
    const blueCoreCenterNudge = 0;
    const morphCenterPhase = THREE.MathUtils.smoothstep(morphProgress, 0.5, 1);
    const railCenterNudge = -0.085 * Math.sin(morphCenterPhase * Math.PI);

    groupRef.current.position.x = railCenterNudge;
    groupRef.current.position.y = 0;
    groupRef.current.scale.setScalar(visualScaleRef.current);
    groupRef.current.rotation.x = -0.3 + Math.sin(travelProgress * Math.PI * 1.2) * 0.07 + Math.sin(spin * 0.72) * 0.05 + morphProgress * 0.04;
    groupRef.current.rotation.y = 0.02 + spin * 0.54 + Math.sin(travelProgress * Math.PI * 1.45) * 0.055 + morphProgress * 0.035;
    groupRef.current.rotation.z = -0.12 + travelProgress * 0.5 + Math.sin(travelProgress * Math.PI * 1.1) * 0.035 + Math.sin(spin * 0.52) * 0.035;

    if (polyhedronRef.current) {
      polyhedronRef.current.visible = polyOpacity > 0.01;
      polyhedronRef.current.scale.setScalar(1 - morphProgress * 0.16);
      polyhedronRef.current.rotation.x = morphProgress * 0.08 + Math.sin(spin * 0.9) * 0.035;
      polyhedronRef.current.rotation.y = -morphProgress * 0.06 + spin * 0.16;
      polyhedronRef.current.rotation.z = Math.sin(spin * 0.6) * 0.035;
    }

    if (polyCoreGroupRef.current) {
      polyCoreGroupRef.current.position.x = blueCoreCenterNudge * (1 - morphProgress * 0.56);
      polyCoreGroupRef.current.position.y = 0;
      polyCoreGroupRef.current.rotation.y = -spin * 0.18;
      polyCoreGroupRef.current.rotation.z = spin * 0.08;
    }

    if (cubeRef.current) {
      cubeRef.current.visible = cubeOpacity > 0.01;
      cubeRef.current.position.x = 0;
      cubeRef.current.position.y = 0;
      cubeRef.current.scale.setScalar(0.82 + morphProgress * 0.18);
      cubeRef.current.rotation.x = -0.22 + (1 - morphProgress) * -0.06;
      cubeRef.current.rotation.y = 0.04 + (1 - morphProgress) * 0.04 + spin * 0.12;
      cubeRef.current.rotation.z = -0.04 + Math.sin(travelProgress * Math.PI * 1.28) * 0.018 + Math.sin(spin * 0.48) * 0.02;
    }

    if (cubeCoreGroupRef.current) {
      cubeCoreGroupRef.current.position.x = blueCoreCenterNudge;
      cubeCoreGroupRef.current.position.y = 0;
      cubeCoreGroupRef.current.rotation.y = -spin * 0.1;
    }

    if (edgeMaterialRef.current) edgeMaterialRef.current.opacity = 0.22 * polyShellOpacity;
    if (coreMaterialRef.current) coreMaterialRef.current.opacity = 0.92 * polyCoreOpacity;
    if (cubeShellMaterialRef.current) cubeShellMaterialRef.current.opacity = 0.16 * cubeOpacity;
    if (cubeEdgeMaterialRef.current) cubeEdgeMaterialRef.current.opacity = 0.035 * cubeOpacity;
    if (cubeCoreMaterialRef.current) cubeCoreMaterialRef.current.opacity = cubeOpacity;
    if (cubeLidMaterialRef.current) cubeLidMaterialRef.current.opacity = 0.82 * cubeOpacity;
    if (cubeHighlightMaterialRef.current) cubeHighlightMaterialRef.current.opacity = 0.18 * cubeOpacity;
  });

  return (
    <group ref={groupRef}>
      <pointLight color="#38bdf8" intensity={3.2} distance={5.2} position={[0.1, 0.05, 0.42]} />
      <pointLight color="#ffffff" intensity={4.5} distance={4.8} position={[-1.4, 1.3, 1.8]} />
      <spotLight color="#ffffff" intensity={2.2} distance={7.5} angle={0.42} penumbra={0.86} position={[-2.2, 2.8, 3.4]} />
      <directionalLight color="#e0f7ff" intensity={1.35} position={[-3.2, 2.2, 2.7]} />
      <group ref={polyhedronRef}>
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial ref={edgeMaterialRef} color="#9bdcf2" transparent opacity={0.18} />
        </lineSegments>
        <group ref={polyCoreGroupRef}>
          <mesh geometry={coreGeometry} scale={0.9} rotation={[0.18, -0.3, 0.1]}>
            <meshPhysicalMaterial ref={coreMaterialRef} color="#24afe0" emissive="#078dcc" emissiveIntensity={0.08} roughness={0.42} metalness={0.08} clearcoat={0.22} clearcoatRoughness={0.46} reflectivity={0.22} transparent opacity={0.92} />
          </mesh>
        </group>
      </group>
      <group ref={cubeRef} visible={false}>
        <mesh geometry={cubeGeometry} scale={[1.22, 1.22, 1.22]} rotation={[0.04, -0.05, 0.02]}>
          <meshPhysicalMaterial ref={cubeShellMaterialRef} color="#e5edf1" transparent opacity={0} roughness={0.18} metalness={0.04} clearcoat={0.38} clearcoatRoughness={0.32} reflectivity={0.32} transmission={0.18} thickness={1.08} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <lineSegments geometry={cubeEdgeGeometry}>
          <lineBasicMaterial ref={cubeEdgeMaterialRef} color="#f5fcff" transparent opacity={0} />
        </lineSegments>
        <group ref={cubeCoreGroupRef}>
          <mesh geometry={cubeCoreGeometry} position={[0, -0.24, 0.04]} rotation={[0.02, -0.04, 0.01]}>
            <meshPhysicalMaterial ref={cubeCoreMaterialRef} color="#0284c7" emissive="#0ea5e9" emissiveIntensity={0.22} roughness={0.34} metalness={0.1} clearcoat={0.34} clearcoatRoughness={0.28} reflectivity={0.3} transparent opacity={0} />
          </mesh>
          <mesh geometry={cubeLidGeometry} scale={[1.08, 1, 1.08]} position={[0, 1.36, 0.12]} rotation={[0.05, -0.04, -0.02]}>
            <meshPhysicalMaterial ref={cubeLidMaterialRef} color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={0.38} roughness={0.26} metalness={0.08} clearcoat={0.3} clearcoatRoughness={0.3} reflectivity={0.28} transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh geometry={cubeHighlightGeometry} position={[0, 0.34, 1.02]} rotation={[0.18, 0.02, -0.42]}>
            <meshBasicMaterial ref={cubeHighlightMaterialRef} color="#ffffff" transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export default function HomeDropScene() {
  return (
    <Canvas className="home-drop-canvas" camera={{ position: [0, 0, 5], fov: 42 }} dpr={[1, 1.8]} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}>
      <ambientLight intensity={0.55} />
      <directionalLight color="#ffffff" intensity={1.4} position={[2.5, 3, 4]} />
      <FallingPolyhedron />
    </Canvas>
  );
}

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

type HomeTechLandmarkSceneProps = {
  color: string;
};

function GlassTechOrb({ color }: HomeTechLandmarkSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const shellGeometry = useMemo(() => new THREE.SphereGeometry(1.12, 96, 64), []);
  const innerGeometry = useMemo(() => new THREE.SphereGeometry(0.84, 72, 48), []);
  const facetGeometry = useMemo(() => new THREE.IcosahedronGeometry(0.72, 2), []);
  const colorValue = useMemo(() => new THREE.Color(color), [color]);
  const fresnelMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: colorValue },
      glow: { value: new THREE.Color("#dff8ff") },
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform vec3 glow;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(normalize(vWorldNormal), viewDirection), 0.0), 2.35);
        float innerTint = 0.1 + (1.0 - fresnel) * 0.08;
        vec3 color = mix(tint, glow, fresnel * 0.56);
        gl_FragColor = vec4(color, innerTint + fresnel * 0.3);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }), [colorValue]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.18;
    groupRef.current.rotation.x = Math.sin(performance.now() * 0.00045) * 0.04;
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.42} />
      <hemisphereLight args={["#ffffff", color, 1.25]} />
      <directionalLight color="#ffffff" intensity={4.8} position={[-2.4, 2.8, 4.5]} />
      <pointLight color={color} intensity={5.5} distance={4.5} position={[1.35, -1.1, 2.7]} />
      <pointLight color="#bceeff" intensity={2.4} distance={3.5} position={[-1.8, 0.8, 1.2]} />
      <mesh geometry={shellGeometry}>
        <meshPhysicalMaterial
          color={colorValue}
          transparent
          opacity={0.34}
          transmission={0.4}
          thickness={1.05}
          roughness={0.16}
          ior={1.46}
          clearcoat={1}
          clearcoatRoughness={0.08}
          attenuationColor={colorValue}
          attenuationDistance={1.8}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={shellGeometry} scale={0.994}>
        <meshStandardMaterial
          color={colorValue}
          emissive={colorValue}
          emissiveIntensity={0.12}
          transparent
          opacity={0.2}
          roughness={0.24}
          metalness={0.04}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={shellGeometry} scale={1.006} material={fresnelMaterial} />
      <mesh scale={1.018} geometry={shellGeometry}>
        <meshPhysicalMaterial
          color="#eaf9ff"
          transparent
          opacity={0.3}
          transmission={0.08}
          thickness={0.18}
          roughness={0.04}
          ior={1.5}
          clearcoat={1}
          clearcoatRoughness={0.03}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={innerGeometry}>
        <meshPhysicalMaterial
          color={colorValue}
          emissive={colorValue}
          emissiveIntensity={0.44}
          transparent
          opacity={0.24}
          transmission={0.08}
          thickness={0.7}
          roughness={0.2}
          clearcoat={0.7}
          clearcoatRoughness={0.12}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={facetGeometry} rotation={[0.3, 0.45, 0.1]}>
        <meshPhysicalMaterial
          color={colorValue}
          transparent
          opacity={0.3}
          transmission={0.38}
          thickness={0.45}
          roughness={0.16}
          clearcoat={0.9}
          clearcoatRoughness={0.08}
          flatShading
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export default function HomeTechLandmarkScene({ color }: HomeTechLandmarkSceneProps) {
  return (
    <Canvas
      className="home-tech-landmark-canvas"
      camera={{ position: [0, 0, 3.55], fov: 34 }}
      dpr={[1, 1.6]}
      gl={{ alpha: true, antialias: true }}
    >
      <GlassTechOrb color={color} />
    </Canvas>
  );
}

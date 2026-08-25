import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import javaSvg from "devicon/icons/java/java-original.svg?raw";
import goSvg from "devicon/icons/go/go-line.svg?raw";
import rustSvg from "devicon/icons/rust/rust-original.svg?raw";
import postgresqlSvg from "devicon/icons/postgresql/postgresql-original.svg?raw";

export type HomeTechLandmarkKind = "java" | "go" | "rust" | "postgresql";

type HomeTechLandmarkSceneProps = {
  kind: HomeTechLandmarkKind;
  color: string;
};

const techIcons: Record<HomeTechLandmarkKind, string> = {
  java: javaSvg,
  go: goSvg,
  rust: rustSvg,
  postgresql: postgresqlSvg,
};

const iconScales: Record<HomeTechLandmarkKind, number> = {
  java: 1.42,
  go: 1.3,
  rust: 1.34,
  postgresql: 1.36,
};

const fallbackFill: Record<HomeTechLandmarkKind, string> = {
  java: "#0074bd",
  go: "#00acd7",
  rust: "#111827",
  postgresql: "#336791",
};

function createIconMaterial(fill: string) {
  return new THREE.MeshPhysicalMaterial({
    color: fill,
    roughness: 0.18,
    metalness: 0.1,
    clearcoat: 0.56,
    clearcoatRoughness: 0.12,
    emissive: new THREE.Color(fill).lerp(new THREE.Color("#ffffff"), 0.38),
    emissiveIntensity: 0.025,
    side: THREE.DoubleSide,
  });
}

function IconMesh({ kind }: HomeTechLandmarkSceneProps) {
  const icon = useMemo(() => {
    const parsed = new SVGLoader().parse(techIcons[kind]);
    const group = new THREE.Group();
    const materials = new Map<string, THREE.Material>();

    parsed.paths.forEach((path) => {
      const style = (path.userData as { style?: { fill?: string } }).style;
      const fill = style?.fill && style.fill !== "none" ? style.fill : fallbackFill[kind];
      if (!materials.has(fill)) materials.set(fill, createIconMaterial(fill));

      SVGLoader.createShapes(path).forEach((shape) => {
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: 0.07,
          bevelEnabled: true,
          bevelSize: 0.005,
          bevelThickness: 0.005,
          bevelSegments: 1,
        });
        const mesh = new THREE.Mesh(geometry, materials.get(fill));
        mesh.renderOrder = 2;
        group.add(mesh);
      });
    });

    const box = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    group.children.forEach((child) => {
      child.position.x -= center.x;
      child.position.y -= center.y;
      child.position.z -= center.z;
    });

    const scale = iconScales[kind] / Math.max(size.x, size.y);
    group.scale.set(scale, -scale, scale);
    group.position.set(0, 0, 0.06);

    return group;
  }, [kind]);

  return <primitive object={icon} dispose={null} />;
}

function RotatingGlassMark({ kind, color }: HomeTechLandmarkSceneProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.48;
    groupRef.current.rotation.x = Math.sin(performance.now() * 0.00065) * 0.055;
    groupRef.current.rotation.z = Math.cos(performance.now() * 0.0005) * 0.02;
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.62} />
      <directionalLight color="#ffffff" intensity={2.8} position={[-2.4, 3.2, 4.5]} />
      <directionalLight color="#baeaff" intensity={0.9} position={[2.8, -1.4, 2.2]} />
      <mesh renderOrder={0}>
        <sphereGeometry args={[1.1, 96, 64]} />
        <shaderMaterial
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          uniforms={{ rimColor: { value: new THREE.Color("#38bdf8") } }}
          vertexShader={`
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              vNormal = normalize(normalMatrix * normal);
              vViewPosition = -mvPosition.xyz;
              gl_Position = projectionMatrix * mvPosition;
            }
          `}
          fragmentShader={`
            uniform vec3 rimColor;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
              vec3 viewDir = normalize(vViewPosition);
              vec3 normal = normalize(vNormal);
              float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.9);
              float glint = smoothstep(0.78, 1.0, dot(normal, normalize(vec3(-0.42, 0.62, 0.66)))) * 0.075;
              float innerTint = smoothstep(0.2, 1.0, abs(dot(normal, viewDir))) * 0.035;
              float alpha = innerTint + fresnel * 0.3 + glint;
              vec3 glassColor = mix(rimColor, vec3(0.92, 0.98, 1.0), glint * 6.0);
              gl_FragColor = vec4(glassColor, alpha);
            }
          `}
        />
      </mesh>
      <IconMesh kind={kind} color={color} />
      <mesh renderOrder={3} position={[-0.38, 0.4, 0.88]} rotation={[0.36, -0.42, -0.24]} scale={[0.32, 0.12, 0.02]}>
        <sphereGeometry args={[1, 36, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.32} depthWrite={false} />
      </mesh>
      <mesh renderOrder={3} position={[0.38, -0.28, 0.92]} rotation={[0.2, 0.34, 0.36]} scale={[0.18, 0.06, 0.015]}>
        <sphereGeometry args={[1, 28, 12]} />
        <meshBasicMaterial color="#bcefff" transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}

export default function HomeTechLandmarkScene({ kind, color }: HomeTechLandmarkSceneProps) {
  return (
    <Canvas
      className="home-tech-landmark-canvas"
      camera={{ position: [0, 0, 3.25], fov: 34 }}
      dpr={[1, 1.6]}
      gl={{ alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <RotatingGlassMark kind={kind} color={color} />
    </Canvas>
  );
}

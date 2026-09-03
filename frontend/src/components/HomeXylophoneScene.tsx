import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const BAR_COUNT = 82;
const SCROLL_PHASE = 58;

type XylophoneSceneProps = {
  active: boolean;
  reducedMotion: boolean;
  scrollPhaseRef: MutableRefObject<number>;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function GlassXylophone({ active, reducedMotion, scrollPhaseRef }: XylophoneSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const barsRef = useRef<(THREE.Mesh | null)[]>([]);
  const shellsRef = useRef<(THREE.Mesh | null)[]>([]);
  const shineRef = useRef<(THREE.Mesh | null)[]>([]);
  const phaseRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });
  const { viewport } = useThree();

  const barGeometry = useMemo(() => new RoundedBoxGeometry(1.18, 0.15, 0.25, 8, 0.065), []);
  const shellGeometry = useMemo(() => new RoundedBoxGeometry(1.23, 0.18, 0.285, 8, 0.07), []);
  const shineGeometry = useMemo(() => new RoundedBoxGeometry(0.56, 0.018, 0.018, 4, 0.012), []);
  const barColors = useMemo(() => {
    const spectrum = ["#ff3b30", "#ff8a1f", "#ffd84d", "#76e268", "#18d6a9", "#18c8ff", "#1677ff", "#8b5cf6", "#ff4fd8"].map((color) => new THREE.Color(color));
    return Array.from({ length: BAR_COUNT }, (_, index) => {
      const cycle = (index / BAR_COUNT) * (spectrum.length - 1);
      const left = Math.floor(cycle);
      const right = Math.min(spectrum.length - 1, left + 1);
      return spectrum[left].clone().lerp(spectrum[right], cycle - left);
    });
  }, []);
  const barMaterials = useMemo(() => barColors.map((color) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    material.toneMapped = false;
    return material;
  }), [barColors]);
  const shellMaterial = useMemo(() => {
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#ffffff"),
      metalness: 0,
      roughness: 0.08,
      transmission: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return material;
  }, []);
  const shineMaterial = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return material;
  }, []);
  useEffect(() => {
    return () => {
      barGeometry.dispose();
      shellGeometry.dispose();
      shineGeometry.dispose();
      shellMaterial.dispose();
      shineMaterial.dispose();
      barMaterials.forEach((material) => material.dispose());
    };
  }, [barGeometry, barMaterials, shellGeometry, shellMaterial, shineGeometry, shineMaterial]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    const bars = barsRef.current;
    const shells = shellsRef.current;
    const shines = shineRef.current;
    if (!group) return;

    const pointer = pointerRef.current;
    pointer.x = THREE.MathUtils.damp(pointer.x, state.pointer.x, 4.6, delta);
    pointer.y = THREE.MathUtils.damp(pointer.y, state.pointer.y, 4.6, delta);

    const targetPhase = reducedMotion ? 8 : scrollPhaseRef.current;
    phaseRef.current = THREE.MathUtils.damp(phaseRef.current, targetPhase, active ? 4.2 : 1.2, delta);
    const phase = phaseRef.current;
    const time = state.clock.elapsedTime;
    const leftAnchor = viewport.width > 9 ? -viewport.width * 0.29 : -viewport.width * 0.18;
    group.position.x = THREE.MathUtils.damp(group.position.x, leftAnchor, 2.8, delta);
    group.position.y = THREE.MathUtils.damp(group.position.y, -0.06, 2.8, delta);

    group.rotation.x = THREE.MathUtils.damp(group.rotation.x, 0.47 + pointer.y * 0.1, 3.2, delta);
    group.rotation.y = THREE.MathUtils.damp(group.rotation.y, phase * 0.025 + time * (reducedMotion ? 0.04 : 0.12) + pointer.x * 0.22, 2.7, delta);
    group.rotation.z = THREE.MathUtils.damp(group.rotation.z, -0.44 + pointer.x * 0.07, 3, delta);

    for (let i = 0; i < BAR_COUNT; i += 1) {
      const slot = ((i + phase) % BAR_COUNT + BAR_COUNT) % BAR_COUNT;
      const t = slot / BAR_COUNT;
      const theta = slot * 0.29 + Math.PI * 0.08;
      const y = (t - 0.5) * 7.55;
      const radius = 1.58 + Math.sin(theta * 1.55 + time * 0.45) * 0.08;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      const centerLift = 1 - Math.abs(t - 0.5) * 2;
      const pointerDistance = Math.hypot(x / 2.9 - pointer.x, y / 3.4 - pointer.y);
      const pointerPulse = active && !reducedMotion ? clamp(1 - pointerDistance / 0.68) : 0;
      const length = 0.78 + centerLift * 0.62 + Math.sin(i * 0.47) * 0.045;
      const breathing = reducedMotion ? 0 : Math.sin(time * 1.6 + i * 0.3) * 0.035;

      const bar = bars[i];
      const shell = shells[i];
      const shine = shines[i];
      if (!bar || !shell || !shine) continue;

      bar.position.set(x, y, z);
      bar.rotation.set(0.58, -theta + Math.PI * 0.5, 0.2 + Math.sin(theta) * 0.05);
      bar.scale.set(length * (1 + pointerPulse * 0.18), 1 + pointerPulse * 0.7 + breathing, 1 + pointerPulse * 0.22);

      shell.position.set(x + Math.cos(theta) * 0.018, y + 0.012, z + Math.sin(theta) * 0.018);
      shell.rotation.copy(bar.rotation);
      shell.scale.set(length * (1 + pointerPulse * 0.18), 1.02 + pointerPulse * 0.68 + breathing, 1.02 + pointerPulse * 0.22);

      shine.position.set(x + Math.cos(theta) * 0.04, y + 0.084, z + Math.sin(theta) * 0.04);
      shine.rotation.copy(bar.rotation);
      shine.scale.set(length * 0.82, 1, 1);
    }
  });

  return (
    <group ref={groupRef} scale={0.94}>
      {barMaterials.map((material, index) => (
        <group key={index}>
          <mesh ref={(node) => { barsRef.current[index] = node; }} geometry={barGeometry} material={material} />
          <mesh ref={(node) => { shellsRef.current[index] = node; }} geometry={shellGeometry} material={shellMaterial} />
          <mesh ref={(node) => { shineRef.current[index] = node; }} geometry={shineGeometry} material={shineMaterial} />
        </group>
      ))}
    </group>
  );
}

function AmbientGlassField({ reducedMotion }: { reducedMotion: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const particles = useMemo(() => Array.from({ length: 28 }, (_, index) => {
    const angle = index * 1.618;
    const radius = 2.25 + (index % 6) * 0.34;
    return {
      x: Math.cos(angle) * radius,
      y: ((index % 9) - 4) * 0.56,
      z: -1.4 - (index % 5) * 0.46,
      scale: 0.025 + (index % 4) * 0.012,
    };
  }), []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group || reducedMotion) return;
    group.rotation.y = THREE.MathUtils.damp(group.rotation.y, state.clock.elapsedTime * 0.045, 1.6, delta);
  });

  return (
    <group ref={groupRef}>
      {particles.map((particle, index) => (
        <mesh key={index} position={[particle.x, particle.y, particle.z]} scale={particle.scale}>
          <sphereGeometry args={[1, 14, 14]} />
          <meshBasicMaterial color={index % 3 === 0 ? "#0ea5e9" : "#ffffff"} transparent opacity={index % 3 === 0 ? 0.22 : 0.34} />
        </mesh>
      ))}
    </group>
  );
}

function XylophoneCanvas({ active, reducedMotion, scrollPhaseRef }: XylophoneSceneProps) {
  return (
    <Canvas
      className="home-xylophone-canvas"
      camera={{ position: [0, 0.05, 9.4], fov: 36, near: 0.1, far: 80 }}
      dpr={[1, 1.8]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["transparent"]} />
      <hemisphereLight args={["#ffffff", "#bfeeff", 2.15]} />
      <ambientLight intensity={1.74} />
      <directionalLight position={[2.8, 4.8, 5]} intensity={4.2} color="#ffffff" />
      <directionalLight position={[-4, -1.5, 3]} intensity={2.8} color="#7dd3fc" />
      <pointLight position={[0, 1.8, 3.4]} intensity={34} color="#38bdf8" distance={8.5} />
      <AmbientGlassField reducedMotion={reducedMotion} />
      <GlassXylophone active={active} reducedMotion={reducedMotion} scrollPhaseRef={scrollPhaseRef} />
    </Canvas>
  );
}

export default function HomeXylophoneBackdrop() {
  const backdropRef = useRef<HTMLDivElement>(null);
  const scrollPhaseRef = useRef(0);
  const [shouldMount, setShouldMount] = useState(false);
  const [active, setActive] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    updateMotion();
    media.addEventListener("change", updateMotion);
    return () => media.removeEventListener("change", updateMotion);
  }, []);

  useEffect(() => {
    const mountTimer = window.setTimeout(() => setShouldMount(true), 120);
    const updateVisibility = () => setActive(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      window.clearTimeout(mountTimer);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const homeRoot = backdrop.closest<HTMLElement>(".home-motion-root");

    let ticking = false;
    const updateScrollPhase = () => {
      ticking = false;
      const rect = homeRoot?.getBoundingClientRect();
      const travel = Math.max(1, (homeRoot?.offsetHeight ?? document.documentElement.scrollHeight) - window.innerHeight);
      const progress = rect ? clamp(-rect.top / travel) : clamp(window.scrollY / travel);
      scrollPhaseRef.current = progress * SCROLL_PHASE;
    };
    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateScrollPhase);
    };

    updateScrollPhase();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  return (
    <div ref={backdropRef} className="home-xylophone-backdrop" aria-hidden="true">
      <div className="home-xylophone-surface" aria-hidden="true" />
      <div className="home-xylophone-glass-ring" aria-hidden="true" />
      <div className="home-xylophone-scene" aria-hidden="true">
        {shouldMount ? <XylophoneCanvas active={active} reducedMotion={reducedMotion} scrollPhaseRef={scrollPhaseRef} /> : null}
      </div>
    </div>
  );
}

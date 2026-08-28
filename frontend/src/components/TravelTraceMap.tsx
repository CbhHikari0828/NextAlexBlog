import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

type GeoJsonFeature = {
  properties?: { name?: string };
  geometry?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
};

type GeoJsonData = {
  features?: GeoJsonFeature[];
};

type ProvinceShape = {
  id: string;
  name: string;
  shape: THREE.Shape;
  color: string;
  visited: boolean;
};

const provincePalette = ["#ffffff", "#fbfdff", "#f6faff"];
const mapDepth = 1.02;

function isVisitedRegion(name: string) {
  return name.includes("广东") || name.includes("上海") || name.includes("贵州");
}

function mercatorPoint([lon, lat]: [number, number]) {
  const safeLat = Math.max(-85, Math.min(85, lat));
  const y = Math.log(Math.tan(Math.PI / 4 + (safeLat * Math.PI) / 360)) * (180 / Math.PI);
  return new THREE.Vector2(lon, y);
}

function isRing(value: unknown): value is [number, number][] {
  return Array.isArray(value) && value.length > 2 && Array.isArray(value[0]) && typeof value[0][0] === "number" && typeof value[0][1] === "number";
}

function polygonList(feature: GeoJsonFeature) {
  const geometry = feature.geometry;
  if (!geometry) return [] as [number, number][][];

  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates as [number, number][][]];
  }

  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates as [number, number][][][];
  }

  return [] as [number, number][][];
}

function buildMapData(geoJson: GeoJsonData) {
  const projectedRings: { featureName: string; polygonIndex: number; rings: THREE.Vector2[][] }[] = [];
  const bounds = new THREE.Box2();
  let hasPoint = false;

  geoJson.features?.forEach((feature, featureIndex) => {
    polygonList(feature).forEach((polygon, polygonIndex) => {
      const rings = polygon.filter(isRing).map((ring) => ring.map((point) => mercatorPoint(point)));
      rings.forEach((ring) => ring.forEach((point) => {
        bounds.expandByPoint(point);
        hasPoint = true;
      }));
      if (rings[0]?.length > 2) {
        projectedRings.push({ featureName: feature.properties?.name || `area-${featureIndex}`, polygonIndex, rings });
      }
    });
  });

  if (!hasPoint) {
    return { shapes: [] as ProvinceShape[] };
  }

  const center = bounds.getCenter(new THREE.Vector2());
  const size = bounds.getSize(new THREE.Vector2());
  const scale = 15.9 / Math.max(size.x, size.y);
  const normalize = (point: THREE.Vector2) => new THREE.Vector2((point.x - center.x) * scale, (point.y - center.y) * scale);

  const shapes = projectedRings.reduce<ProvinceShape[]>((result, item, index) => {
    const outer = item.rings[0].map(normalize);
    const outerArea = Math.abs(THREE.ShapeUtils.area(outer));
    const visited = isVisitedRegion(item.featureName);
    if (outerArea < (visited ? 0.006 : 0.052)) return result;

    const shape = new THREE.Shape(outer);
    item.rings.slice(1).forEach((hole) => {
      if (hole.length > 2) shape.holes.push(new THREE.Path(hole.map(normalize)));
    });

    result.push({
      id: `${item.featureName}-${item.polygonIndex}-${index}`,
      name: item.featureName,
      shape,
      color: visited ? "#1288ff" : provincePalette[index % provincePalette.length],
      visited,
    });
    return result;
  }, []);

  return { shapes };
}

function ProvinceMesh({ province }: { province: ProvinceShape }) {
  const geometry = useMemo(() => new THREE.ExtrudeGeometry(province.shape, {
    depth: mapDepth,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.035,
    bevelThickness: 0.075,
  }), [province.shape]);

  const materials = useMemo(() => [
    new THREE.MeshPhysicalMaterial({
      color: province.color,
      roughness: province.visited ? 0.2 : 0.34,
      metalness: province.visited ? 0.08 : 0.02,
      clearcoat: province.visited ? 1 : 0.88,
      clearcoatRoughness: province.visited ? 0.16 : 0.28,
      transparent: true,
      opacity: 0.99,
    }),
    new THREE.MeshStandardMaterial({ color: province.visited ? "#075fbd" : "#d7e3f3", roughness: 0.58, metalness: province.visited ? 0.12 : 0.04 }),
  ], [province.color, province.visited]);

  useEffect(() => () => {
    geometry.dispose();
    materials.forEach((material) => material.dispose());
  }, [geometry, materials]);

  return <mesh geometry={geometry} material={materials} castShadow receiveShadow />;
}

function ProvinceShadow({ province }: { province: ProvinceShape }) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(province.shape), [province.shape]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: "#8ca6ca", transparent: true, opacity: 0.16, depthWrite: false }), []);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <mesh geometry={geometry} material={material} position={[0.22, -0.48, -0.18]} />;
}

function ProvinceHighlight({ province }: { province: ProvinceShape }) {
  const points = useMemo(() => {
    const boundary = province.shape.getPoints(180).map((point) => new THREE.Vector3(point.x, point.y, mapDepth + 0.085));
    if (boundary.length > 0) boundary.push(boundary[0].clone());
    return boundary;
  }, [province.shape]);
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  const material = useMemo(() => new THREE.LineBasicMaterial({ color: province.visited ? "#e8faff" : "#8ca9cc", transparent: true, opacity: province.visited ? 0.9 : 0.66, depthWrite: false }), [province.visited]);
  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <primitive object={line} />;
}

function TravelScene({ geoJson }: { geoJson: GeoJsonData }) {
  const groupRef = useRef<THREE.Group>(null);
  const { shapes } = useMemo(() => buildMapData(geoJson), [geoJson]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.z = 0.02 + Math.sin(clock.elapsedTime * 0.22) * 0.026;
    groupRef.current.position.z = Math.sin(clock.elapsedTime * 0.8) * 0.08;
  });

  return <>
    <ambientLight intensity={0.72} />
    <hemisphereLight args={["#ffffff", "#eaf3ff", 1.45]} />
    <directionalLight position={[-8, -11, 15]} intensity={2.35} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
    <pointLight position={[6.5, 2.8, 8]} intensity={2.25} color="#ffffff" />
    <pointLight position={[-7, -7, 5]} intensity={1.15} color="#9fc7ff" />
    <group ref={groupRef} rotation={[-1.14, 0.02, 0.02]} position={[0, 0.15, 1.1]}>
      {shapes.map((province) => <ProvinceShadow province={province} key={`${province.id}-shadow`} />)}
      {shapes.map((province) => <ProvinceMesh province={province} key={province.id} />)}
      {shapes.map((province) => <ProvinceHighlight province={province} key={`${province.id}-highlight`} />)}
    </group>
    <ContactShadows position={[0, -0.9, -1.05]} opacity={0.13} scale={23} blur={3.2} far={14} color="#7f9fc5" />
    <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={0.72} maxPolarAngle={1.18} autoRotate autoRotateSpeed={0.22} />
  </>;
}

export default function TravelTraceMap() {
  const [geoJson, setGeoJson] = useState<GeoJsonData | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/maps/china.json")
      .then((response) => {
        if (!response.ok) throw new Error("Map data request failed");
        return response.json() as Promise<GeoJsonData>;
      })
      .then((data) => {
        if (!ignore) setGeoJson(data);
      })
      .catch(() => {
        if (!ignore) setGeoJson({ features: [] });
      });

    return () => {
      ignore = true;
    };
  }, []);

  return <section className="travel-trace" aria-labelledby="travel-trace-title">
    <header className="travel-trace-heading"><h2 id="travel-trace-title">轨迹</h2></header>
    <div className="travel-trace-map-card">
      {geoJson ? <Canvas camera={{ position: [0, -18, 12.8], fov: 35, near: 0.1, far: 1000 }} dpr={[1, 1.85]} gl={{ antialias: true, alpha: true }} shadows>
        <TravelScene geoJson={geoJson} />
      </Canvas> : <div className="travel-trace-loading" aria-hidden="true" />}
    </div>
  </section>;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

type GeoJsonFeature = {
  properties?: { name?: string; adcode?: number | string };
  geometry?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
};

type GeoJsonData = {
  features?: GeoJsonFeature[];
};

type TravelRegionKey = "guangdong" | "shanghai" | "guizhou";

type ProvinceShape = {
  id: string;
  name: string;
  shape: THREE.Shape;
  color: string;
  visited: boolean;
  regionKey: TravelRegionKey | null;
};

type ProjectedProvinceRing = {
  featureName: string;
  adcode: string;
  polygonIndex: number;
  rings: THREE.Vector2[][];
};

const travelRegionStories: Record<TravelRegionKey, { label: string; eyebrow: string; body: string }> = {
  guangdong: {
    label: "广东",
    eyebrow: "起点 / 日常半径",
    body: "这里更像我的长期坐标：写代码、做内容、折腾 AI 创作，很多想法都是从日常工作和夜里的灵感里慢慢长出来的。",
  },
  shanghai: {
    label: "上海",
    eyebrow: "城市观察 / 灵感采样",
    body: "上海留给我的印象是节奏、密度和秩序感。它很适合放进轨迹里，作为技术审美、产品气质和城市经验的一段切片。",
  },
  guizhou: {
    label: "贵州",
    eyebrow: "山地记忆 / 松弛感",
    body: "贵州这一块更偏向自然和松弛：山地、云雾、慢下来的路程，给这个偏技术的网站补一点现实世界里的呼吸感。",
  },
};

const provincePalette = ["#ffffff", "#fbfdff", "#f6faff"];
const mapDepth = 1.02;

function getVisitedRegionKey(adcode: string): TravelRegionKey | null {
  if (adcode === "440000") return "guangdong";
  if (adcode === "310000") return "shanghai";
  if (adcode === "520000") return "guizhou";
  return null;
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
  const projectedRings: ProjectedProvinceRing[] = [];
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
        projectedRings.push({
          featureName: feature.properties?.name || `area-${featureIndex}`,
          adcode: String(feature.properties?.adcode ?? ""),
          polygonIndex,
          rings,
        });
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
    const regionKey = getVisitedRegionKey(item.adcode);
    const visited = regionKey !== null;
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
      regionKey,
    });
    return result;
  }, []);

  return { shapes };
}

function ProvinceMesh({ province, selected, onSelect }: { province: ProvinceShape; selected: boolean; onSelect: (region: TravelRegionKey) => void }) {
  const geometry = useMemo(() => new THREE.ExtrudeGeometry(province.shape, {
    depth: mapDepth,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.035,
    bevelThickness: 0.075,
  }), [province.shape]);

  const materials = useMemo(() => [
    new THREE.MeshPhysicalMaterial({
      color: selected ? "#006dff" : province.color,
      roughness: province.visited ? 0.18 : 0.34,
      metalness: province.visited ? 0.08 : 0.02,
      clearcoat: province.visited ? 1 : 0.88,
      clearcoatRoughness: province.visited ? 0.16 : 0.28,
      transparent: true,
      opacity: 0.99,
    }),
    new THREE.MeshStandardMaterial({ color: province.visited ? "#075fbd" : "#d7e3f3", roughness: 0.58, metalness: province.visited ? 0.12 : 0.04 }),
  ], [province.color, province.visited, selected]);

  useEffect(() => () => {
    geometry.dispose();
    materials.forEach((material) => material.dispose());
  }, [geometry, materials]);

  return <mesh
    geometry={geometry}
    material={materials}
    castShadow
    receiveShadow
    onClick={(event) => {
      if (!province.regionKey) return;
      event.stopPropagation();
      onSelect(province.regionKey);
    }}
    onPointerEnter={(event) => {
      if (!province.regionKey) return;
      event.stopPropagation();
      document.body.style.cursor = "pointer";
    }}
    onPointerLeave={() => {
      if (province.regionKey) document.body.style.cursor = "";
    }}
  />;
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

function ProvinceHighlight({ province, selected }: { province: ProvinceShape; selected: boolean }) {
  const points = useMemo(() => {
    const boundary = province.shape.getPoints(180).map((point) => new THREE.Vector3(point.x, point.y, mapDepth + 0.085));
    if (boundary.length > 0) boundary.push(boundary[0].clone());
    return boundary;
  }, [province.shape]);
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  const material = useMemo(() => new THREE.LineBasicMaterial({ color: selected ? "#ffffff" : province.visited ? "#e8faff" : "#8ca9cc", transparent: true, opacity: selected ? 1 : province.visited ? 0.9 : 0.66, depthWrite: false }), [province.visited, selected]);
  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <primitive object={line} />;
}

function TravelScene({ geoJson, selectedRegion, onSelectRegion }: { geoJson: GeoJsonData; selectedRegion: TravelRegionKey | null; onSelectRegion: (region: TravelRegionKey) => void }) {
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
      {shapes.map((province) => <ProvinceMesh onSelect={onSelectRegion} province={province} selected={province.regionKey !== null && province.regionKey === selectedRegion} key={province.id} />)}
      {shapes.map((province) => <ProvinceHighlight province={province} selected={province.regionKey !== null && province.regionKey === selectedRegion} key={`${province.id}-highlight`} />)}
    </group>
    <ContactShadows position={[0, -0.9, -1.05]} opacity={0.13} scale={23} blur={3.2} far={14} color="#7f9fc5" />
    <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={0.72} maxPolarAngle={1.18} autoRotate autoRotateSpeed={0.22} />
  </>;
}

export default function TravelTraceMap() {
  const [geoJson, setGeoJson] = useState<GeoJsonData | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<TravelRegionKey | null>(null);
  const selectedStory = selectedRegion ? travelRegionStories[selectedRegion] : null;

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
    <div className="travel-trace-body">
      <div className="travel-trace-map-card">
        {geoJson ? <Canvas camera={{ position: [0, -18, 12.8], fov: 35, near: 0.1, far: 1000 }} dpr={[1, 1.85]} gl={{ antialias: true, alpha: true }} shadows onPointerMissed={() => setSelectedRegion(null)}>
          <TravelScene geoJson={geoJson} selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} />
        </Canvas> : <div className="travel-trace-loading" aria-hidden="true" />}
      </div>
      <aside className={`travel-trace-info${selectedStory ? " is-active" : " is-empty"}`} aria-live="polite">
        {selectedStory ? <>
          <span>{selectedStory.eyebrow}</span>
          <h3>{selectedStory.label}</h3>
          <p>{selectedStory.body}</p>
        </> : <>
          <span>点击蓝色区域</span>
          <h3>选择一段轨迹</h3>
          <p>点击地图上被涂蓝的省市区块，旁边会展开对应的城市记忆和轨迹说明。</p>
        </>}
      </aside>
    </div>
  </section>;
}

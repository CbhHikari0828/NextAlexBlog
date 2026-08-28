import { useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, MeshTransmissionMaterial } from "@react-three/drei";
import * as THREE from "three";

const organicVertexShader = `
  uniform float uInflate;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vObjectPosition;

  void main() {
    vec3 displacedPosition = position + normalize(normal) * uInflate;
    vObjectPosition = displacedPosition;
    vec4 worldPosition = modelMatrix * vec4(displacedPosition, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const glassBackFragmentShader = `
  uniform vec3 uGlassColor;
  uniform vec3 uGoldColor;
  uniform float uTime;
  uniform float uMorph;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vObjectPosition;

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float facing = clamp01(abs(dot(normal, viewDirection)));
    float rim = pow(1.0 - facing, 1.12);
    float thickEdge = smoothstep(0.34, 0.92, rim);
    float screenRadius = length(vObjectPosition.xy) / 1.44;
    float organicEdge = smoothstep(0.72, 1.1, screenRadius);
    float lowerGlass = smoothstep(-1.12, -0.22, -vObjectPosition.y) * 0.018;
    float upperGlass = smoothstep(0.24, 1.08, vObjectPosition.y) * 0.012;

    vec3 color = mix(uGlassColor, uGoldColor, organicEdge * 0.1 + lowerGlass * 0.035);
    color += vec3(0.78, 0.92, 1.0) * (thickEdge * 0.22 + organicEdge * 0.16 + upperGlass * 0.1);

    float alpha = thickEdge * 0.012 + organicEdge * 0.01 + lowerGlass * 0.006 + upperGlass * 0.004;
    alpha *= mix(1.0, 0.42, uMorph);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, clamp01(alpha));
  }
`;

const glassHighlightFragmentShader = `
  uniform vec3 uGlassColor;
  uniform vec3 uGoldColor;
  uniform vec3 uIceColor;
  uniform float uTime;
  uniform float uMorph;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vObjectPosition;

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float ellipse(vec2 point, vec2 center, vec2 radius, float angle, float softness) {
    float s = sin(angle);
    float c = cos(angle);
    vec2 translated = point - center;
    vec2 rotated = vec2(c * translated.x + s * translated.y, -s * translated.x + c * translated.y);
    float distanceField = dot(rotated / radius, rotated / radius);
    return exp(-distanceField * softness);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 keyLight = normalize(vec3(-0.42, 0.76, 0.9));
    vec3 sideLight = normalize(vec3(0.82, 0.2, 0.48));

    float facing = clamp01(abs(dot(normal, viewDirection)));
    float rim = 1.0 - facing;
    float rimEdge = smoothstep(0.36, 0.84, rim);
    float outerEdge = pow(rim, 5.2);
    float screenRadius = length(vObjectPosition.xy) / 1.44;
    float perimeter = smoothstep(0.78, 1.08, screenRadius);

    vec3 keyReflect = reflect(-keyLight, normal);
    vec3 sideReflect = reflect(-sideLight, normal);
    float longSpecular = pow(clamp01(dot(keyReflect, viewDirection)), 26.0);
    float sharpSpecular = pow(clamp01(dot(sideReflect, viewDirection)), 74.0);

    vec2 p = vObjectPosition.xy;
    float topSoftbox = ellipse(p, vec2(-0.66, 0.74), vec2(0.78, 0.07), -0.32, 5.2);
    float rightSoftbox = ellipse(p, vec2(0.9, 0.26), vec2(0.24, 0.055), 0.18, 7.0);
    float leftGleam = ellipse(p, vec2(-1.08, 0.0), vec2(0.2, 0.06), -0.62, 6.8);
    float lowerGleam = ellipse(p, vec2(-0.5, -0.9), vec2(0.36, 0.065), 0.28, 6.4);
    float blueCaustic = ellipse(p, vec2(-0.04, -0.04), vec2(0.8, 0.09), -0.18, 6.0);

    float edgeMask = smoothstep(0.34, 0.9, rimEdge + outerEdge * 0.92 + perimeter * 0.44);
    float softboxMask = edgeMask * edgeMask;

    vec3 color = uGlassColor * (edgeMask * 0.5 + outerEdge * 0.52 + perimeter * 0.18);
    color += vec3(1.0) * ((topSoftbox * 1.02 + rightSoftbox * 0.88 + leftGleam * 0.34 + lowerGleam * 0.24) * softboxMask);
    color += vec3(1.0) * (longSpecular * 0.52 + sharpSpecular * 0.4);
    color += uIceColor * (blueCaustic * 0.012 + edgeMask * 0.2 + perimeter * 0.1);
    color += uGoldColor * (outerEdge * 0.018 + lowerGleam * 0.026 + perimeter * 0.018);

    float alpha = edgeMask * 0.12 + outerEdge * 0.18 + perimeter * 0.055;
    alpha += (topSoftbox * 0.16 + rightSoftbox * 0.14 + leftGleam * 0.05 + lowerGleam * 0.034) * softboxMask;
    alpha += longSpecular * 0.026 + sharpSpecular * 0.018 + blueCaustic * 0.002;
    if (alpha < 0.026) discard;
    alpha *= mix(1.0, 0.86, uMorph);
    gl_FragColor = vec4(color, clamp01(alpha));
  }
`;

const coreHighlightFragmentShader = `
  uniform vec3 uHighlightColor;
  uniform vec3 uAquaColor;
  uniform float uTime;
  uniform float uMorph;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vObjectPosition;

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float ellipse(vec2 point, vec2 center, vec2 radius, float angle, float softness) {
    float s = sin(angle);
    float c = cos(angle);
    vec2 translated = point - center;
    vec2 rotated = vec2(c * translated.x + s * translated.y, -s * translated.x + c * translated.y);
    float distanceField = dot(rotated / radius, rotated / radius);
    return exp(-distanceField * softness);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 keyLight = normalize(vec3(-0.62, 0.58, 0.98));
    vec3 sideLight = normalize(vec3(0.78, 0.16, 0.72));
    vec3 reflectedKey = reflect(-keyLight, normal);
    vec3 reflectedSide = reflect(-sideLight, normal);

    float facing = clamp01(dot(normal, viewDirection));
    float fresnel = pow(1.0 - facing, 2.75);
    float softSpecular = pow(clamp01(dot(reflectedKey, viewDirection)), 32.0);
    float smallSpecular = pow(clamp01(dot(reflectedSide, viewDirection)), 96.0);
    vec2 p = vObjectPosition.xy;
    float mainSoftbox = ellipse(p, vec2(-0.48, 0.54), vec2(0.96, 0.18), -0.22, 1.72);
    float shoulderGleam = ellipse(p, vec2(0.66, 0.32), vec2(0.36, 0.09), -0.4, 3.8);
    float lowerGlow = ellipse(p, vec2(-0.44, -0.52), vec2(0.68, 0.14), 0.16, 4.4);
    float centerFade = 1.0 - smoothstep(0.3, 1.12, length(p));

    vec3 color = uHighlightColor * (mainSoftbox * 0.2 + shoulderGleam * 0.18 + softSpecular * 0.03 + smallSpecular * 0.02);
    color += uAquaColor * (fresnel * 0.026 + lowerGlow * 0.028);
    float alpha = mainSoftbox * 0.052 * centerFade + shoulderGleam * 0.045 + softSpecular * 0.005 + smallSpecular * 0.0024 + fresnel * 0.003 + lowerGlow * 0.004;
    alpha *= mix(1.0, 0.82, uMorph);
    gl_FragColor = vec4(color, clamp01(alpha));
  }
`;

const coreBaseFragmentShader = `
  uniform vec3 uTopColor;
  uniform vec3 uMidColor;
  uniform vec3 uDeepColor;
  uniform vec3 uHighlightColor;
  uniform float uTime;
  uniform float uMorph;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vObjectPosition;

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float ellipse(vec2 point, vec2 center, vec2 radius, float angle, float softness) {
    float s = sin(angle);
    float c = cos(angle);
    vec2 translated = point - center;
    vec2 rotated = vec2(c * translated.x + s * translated.y, -s * translated.x + c * translated.y);
    float distanceField = dot(rotated / radius, rotated / radius);
    return exp(-distanceField * softness);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 keyLight = normalize(vec3(-0.54, 0.72, 0.9));
    vec3 sideLight = normalize(vec3(0.72, 0.18, 0.58));

    float facing = clamp01(dot(normal, viewDirection));
    float fresnel = pow(1.0 - facing, 2.05);
    float diffuse = clamp01(dot(normal, keyLight) * 0.5 + 0.5);
    float side = clamp01(dot(normal, sideLight) * 0.5 + 0.5);
    float lowerDepth = 1.0 - smoothstep(-0.9, -0.05, vObjectPosition.y);
    float rightTurn = smoothstep(0.18, 1.0, vObjectPosition.x);
    float leftTurn = 1.0 - smoothstep(-0.95, -0.1, vObjectPosition.x);
    float backDepth = smoothstep(0.1, 0.88, abs(vObjectPosition.z));
    float vertical = smoothstep(-0.98, 0.86, vObjectPosition.y);
    float softFlow = sin(vObjectPosition.x * 2.2 + vObjectPosition.y * 1.35 + vObjectPosition.z * 1.2 + uTime * 0.18) * 0.5 + 0.5;

    vec3 color = mix(uDeepColor, uMidColor, diffuse * 0.48 + vertical * 0.18 + softFlow * 0.05);
    color = mix(color, uTopColor, side * 0.16 + vertical * 0.12);
    color = mix(color, uDeepColor, lowerDepth * 0.2 + rightTurn * 0.13 + backDepth * 0.08);
    color = mix(color, uMidColor, fresnel * 0.12);

    vec3 reflectedKey = reflect(-keyLight, normal);
    vec3 reflectedSide = reflect(-sideLight, normal);
    float broadSpecular = pow(clamp01(dot(reflectedKey, viewDirection)), 18.0);
    float crispSpecular = pow(clamp01(dot(reflectedSide, viewDirection)), 82.0);
    vec2 p = vObjectPosition.xy;
    float softbox = ellipse(p, vec2(-0.42, 0.48), vec2(0.52, 0.16), -0.24, 2.2);
    float sideGleam = ellipse(p, vec2(0.72, 0.36), vec2(0.32, 0.08), 0.18, 4.6);
    float lowerGleam = ellipse(p, vec2(-0.42, -0.48), vec2(0.42, 0.11), 0.08, 5.2);
    float highlightMask = clamp01(facing * 0.76 + fresnel * 0.24);

    color += uHighlightColor * ((softbox * 0.2 + sideGleam * 0.34 + lowerGleam * 0.09) * highlightMask);
    color += uHighlightColor * (broadSpecular * 0.22 + crispSpecular * 0.42);
    color = mix(color, vec3(0.0, 0.28, 0.7), (rightTurn + lowerDepth) * 0.045);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const coreDepthFragmentShader = `
  uniform vec3 uDeepColor;
  uniform vec3 uEdgeColor;
  uniform float uTime;
  uniform float uMorph;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vObjectPosition;

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float facing = clamp01(dot(normal, viewDirection));
    float rim = pow(1.0 - facing, 2.15);
    float lowerVolume = 1.0 - smoothstep(-0.94, -0.18, vObjectPosition.y);
    float leftVolume = 1.0 - smoothstep(-0.72, 0.32, vObjectPosition.x);
    float innerTurn = smoothstep(0.12, 0.78, abs(vObjectPosition.z));
    float flow = sin(vObjectPosition.x * 2.0 + vObjectPosition.y * 1.3 + uTime * 0.18) * 0.5 + 0.5;

    vec3 color = mix(uEdgeColor, uDeepColor, lowerVolume * 0.58 + leftVolume * 0.25 + innerTurn * 0.2);
    color = mix(color, uEdgeColor, rim * 0.2 + flow * 0.035);
    float alpha = rim * 0.18 + lowerVolume * 0.13 + leftVolume * 0.055 + innerTurn * 0.035;
    alpha *= mix(1.0, 0.82, uMorph);
    if (alpha < 0.018) discard;
    gl_FragColor = vec4(color, clamp01(alpha));
  }
`;

type OrganicProfile = "glass" | "core";

type MorphGeometryOptions = {
  radius: number;
  widthSegments?: number;
  heightSegments?: number;
  profile: OrganicProfile;
  phase?: number;
  blobScale?: [number, number, number];
  cubeScale?: [number, number, number];
  cubeRoundness?: number;
  blobCubeInfluence?: number;
};

type MorphGeometryData = {
  geometry: THREE.BufferGeometry;
  blobPositions: Float32Array;
  cubePositions: Float32Array;
};

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}

function createOrganicMorphGeometry({
  radius,
  widthSegments = 160,
  heightSegments = 112,
  profile,
  phase = 0,
  blobScale = [1, 1, 1],
  cubeScale = [1, 1, 1],
  cubeRoundness = 0.58,
  blobCubeInfluence = profile === "glass" ? 0.2 : 0.16,
}: MorphGeometryOptions): MorphGeometryData {
  const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  geometry.deleteAttribute("uv");
  const source = geometry.attributes.position as THREE.BufferAttribute;
  const blobPositions = new Float32Array(source.count * 3);
  const cubePositions = new Float32Array(source.count * 3);
  const blobCenter = new THREE.Vector3();
  const cubeCenter = new THREE.Vector3();
  const direction = new THREE.Vector3();

  const lobeA = profile === "glass" ? new THREE.Vector3(-0.72, 0.18, 0.38).normalize() : new THREE.Vector3(-0.3, 0.64, 0.42).normalize();
  const lobeB = profile === "glass" ? new THREE.Vector3(0.62, 0.48, 0.22).normalize() : new THREE.Vector3(0.56, -0.12, 0.38).normalize();
  const lobeC = profile === "glass" ? new THREE.Vector3(0.18, -0.84, -0.24).normalize() : new THREE.Vector3(-0.42, -0.66, -0.16).normalize();
  const dentA = profile === "glass" ? new THREE.Vector3(0.12, 0.92, -0.16).normalize() : new THREE.Vector3(0.74, 0.42, -0.16).normalize();
  const dentB = profile === "glass" ? new THREE.Vector3(-0.54, -0.54, 0.44).normalize() : new THREE.Vector3(-0.78, 0.08, 0.42).normalize();
  const xyWave = profile === "glass" ? 0.116 : 0.096;
  const lobeStrength = profile === "glass" ? 0.18 : 0.14;
  const dentStrength = profile === "glass" ? 0.088 : 0.068;
  const twistStrength = profile === "glass" ? 0.062 : 0.043;

  for (let i = 0; i < source.count; i += 1) {
    direction.set(source.getX(i), source.getY(i), source.getZ(i)).normalize();
    const angle = Math.atan2(direction.y, direction.x);
    const equator = Math.pow(Math.max(0, 1 - Math.abs(direction.z)), 0.88);
    const screenWeight = Math.pow(Math.sqrt(direction.x * direction.x + direction.y * direction.y), 0.72);
    const radialWave =
      Math.sin(angle * 5.0 + phase) * xyWave +
      Math.cos(angle * 3.0 - phase * 0.7) * xyWave * 0.56 +
      Math.sin(angle * 2.0 + phase * 1.44) * xyWave * 0.32;
    const directionalBulge =
      Math.pow(Math.max(0, direction.dot(lobeA)), 1.28) * lobeStrength +
      Math.pow(Math.max(0, direction.dot(lobeB)), 1.34) * lobeStrength * 0.78 +
      Math.pow(Math.max(0, direction.dot(lobeC)), 1.48) * lobeStrength * 0.72;
    const directionalDent =
      Math.pow(Math.max(0, direction.dot(dentA)), 1.36) * dentStrength +
      Math.pow(Math.max(0, direction.dot(dentB)), 1.54) * dentStrength * 0.72;
    const shellLip = profile === "glass"
      ? Math.pow(screenWeight, 2.4) * Math.sin(angle * 6.0 - 0.54) * 0.035
      : Math.pow(screenWeight, 2.2) * Math.sin(angle * 3.0 + 0.72) * 0.02;
    const radial = radius * (1 + (radialWave + shellLip) * equator + directionalBulge - directionalDent);
    const twist = Math.sin(angle * 2.0 + direction.z * 2.8 + phase) * radius * twistStrength * equator;

    const maxComponent = Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)) || 1;
    const cubeX = (direction.x / maxComponent) * radius * cubeScale[0];
    const cubeY = (direction.y / maxComponent) * radius * cubeScale[1];
    const cubeZ = (direction.z / maxComponent) * radius * cubeScale[2];
    const roundedCubeX = THREE.MathUtils.lerp(cubeX, direction.x * radius * cubeScale[0] * 1.08, cubeRoundness);
    const roundedCubeY = THREE.MathUtils.lerp(cubeY, direction.y * radius * cubeScale[1] * 1.08, cubeRoundness);
    const roundedCubeZ = THREE.MathUtils.lerp(cubeZ, direction.z * radius * cubeScale[2] * 1.08, cubeRoundness);

    const rawBlobX = direction.x * radial * blobScale[0] + direction.y * twist + lobeA.x * directionalBulge * radius * 0.2 - dentA.x * directionalDent * radius * 0.12;
    const rawBlobY = direction.y * radial * blobScale[1] - direction.x * twist * 0.72 + lobeA.y * directionalBulge * radius * 0.2 - dentA.y * directionalDent * radius * 0.12;
    const rawBlobZ = direction.z * radial * blobScale[2] + Math.sin(angle * 4.0 + phase) * radius * 0.018 * equator;
    const blobBlend = blobCubeInfluence * (0.45 + equator * 0.55);
    const blobX = THREE.MathUtils.lerp(rawBlobX, roundedCubeX, blobBlend);
    const blobY = THREE.MathUtils.lerp(rawBlobY, roundedCubeY, blobBlend);
    const blobZ = THREE.MathUtils.lerp(rawBlobZ, roundedCubeZ, blobBlend * 0.74);

    const index = i * 3;
    blobPositions[index] = blobX;
    blobPositions[index + 1] = blobY;
    blobPositions[index + 2] = blobZ;
    cubePositions[index] = roundedCubeX;
    cubePositions[index + 1] = roundedCubeY;
    cubePositions[index + 2] = roundedCubeZ;
    blobCenter.x += blobX;
    blobCenter.y += blobY;
    blobCenter.z += blobZ;
    cubeCenter.x += roundedCubeX;
    cubeCenter.y += roundedCubeY;
    cubeCenter.z += roundedCubeZ;
  }

  blobCenter.divideScalar(source.count);
  cubeCenter.divideScalar(source.count);

  for (let i = 0; i < source.count; i += 1) {
    const index = i * 3;
    blobPositions[index] -= blobCenter.x;
    blobPositions[index + 1] -= blobCenter.y;
    blobPositions[index + 2] -= blobCenter.z;
    cubePositions[index] -= cubeCenter.x;
    cubePositions[index + 1] -= cubeCenter.y;
    cubePositions[index + 2] -= cubeCenter.z;
    source.setXYZ(i, blobPositions[index], blobPositions[index + 1], blobPositions[index + 2]);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, blobPositions, cubePositions };
}

function applyMorph(
  geometry: THREE.BufferGeometry,
  blobPositions: Float32Array,
  cubePositions: Float32Array,
  progress: number,
) {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  const eased = smoothstep(THREE.MathUtils.clamp(progress, 0, 1));

  for (let i = 0; i < array.length; i += 1) {
    array[i] = THREE.MathUtils.lerp(blobPositions[i], cubePositions[i], eased);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function MorphMesh({
  data,
  progressRef,
  renderOrder,
  children,
}: {
  data: MorphGeometryData;
  progressRef: MutableRefObject<number>;
  renderOrder?: number;
  children?: ReactNode;
}) {
  const lastProgressRef = useRef(-1);

  useFrame(() => {
    const progress = progressRef.current;
    if (Math.abs(lastProgressRef.current - progress) < 0.001) return;
    lastProgressRef.current = progress;
    applyMorph(data.geometry, data.blobPositions, data.cubePositions, progress);
  });

  return (
    <mesh geometry={data.geometry} renderOrder={renderOrder}>
      {children}
    </mesh>
  );
}

function FallingGlassModel() {
  const groupRef = useRef<THREE.Group>(null);
  const coreBaseMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const glassBackMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const glassHighlightMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const coreDepthMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const coreHighlightMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const morphProgressRef = useRef(0);
  const travelProgressRef = useRef(0);
  const visualScaleRef = useRef(1);
  const spinRef = useRef(0);

  const glassBackUniforms = useMemo(() => ({
    uGlassColor: { value: new THREE.Color("#f8fbff") },
    uGoldColor: { value: new THREE.Color("#fff4d6") },
    uInflate: { value: 0.02 },
    uTime: { value: 0 },
    uMorph: { value: 0 },
  }), []);

  const glassHighlightUniforms = useMemo(() => ({
    uGlassColor: { value: new THREE.Color("#f9fdff") },
    uGoldColor: { value: new THREE.Color("#fff4d6") },
    uIceColor: { value: new THREE.Color("#7ccfff") },
    uInflate: { value: 0.045 },
    uTime: { value: 0 },
    uMorph: { value: 0 },
  }), []);

  const coreHighlightUniforms = useMemo(() => ({
    uHighlightColor: { value: new THREE.Color("#ffffff") },
    uAquaColor: { value: new THREE.Color("#80ecff") },
    uInflate: { value: 0.024 },
    uTime: { value: 0 },
    uMorph: { value: 0 },
  }), []);

  const coreBaseUniforms = useMemo(() => ({
    uTopColor: { value: new THREE.Color("#2ed8ff") },
    uMidColor: { value: new THREE.Color("#049bff") },
    uDeepColor: { value: new THREE.Color("#075bd2") },
    uHighlightColor: { value: new THREE.Color("#f9feff") },
    uInflate: { value: 0 },
    uTime: { value: 0 },
    uMorph: { value: 0 },
  }), []);

  const coreDepthUniforms = useMemo(() => ({
    uDeepColor: { value: new THREE.Color("#0049b6") },
    uEdgeColor: { value: new THREE.Color("#087dff") },
    uInflate: { value: 0.018 },
    uTime: { value: 0 },
    uMorph: { value: 0 },
  }), []);

  const glassData = useMemo(() => createOrganicMorphGeometry({
    radius: 1.26,
    widthSegments: 176,
    heightSegments: 116,
    profile: "glass",
    phase: 0.82,
    blobScale: [0.98, 0.9, 0.82],
    cubeScale: [0.8, 0.76, 0.68],
    cubeRoundness: 0.66,
    blobCubeInfluence: 0.26,
  }), []);

  const coreData = useMemo(() => createOrganicMorphGeometry({
    radius: 1.0,
    widthSegments: 156,
    heightSegments: 104,
    profile: "core",
    phase: 2.14,
    blobScale: [1.03, 0.88, 0.8],
    cubeScale: [0.74, 0.69, 0.63],
    cubeRoundness: 0.78,
    blobCubeInfluence: 0.22,
  }), []);

  useFrame((state, delta) => {
    const dropStyle = typeof document === "undefined"
      ? undefined
      : getComputedStyle(document.querySelector<HTMLElement>(".home-drop-visual") ?? document.documentElement);
    // The visual reference keeps the object as one organic glass form;
    // scroll still drives travel/scale, but no longer morphs it into a cube.
    const rawMorphProgress = 0;
    const rawVisualScale = Number.parseFloat(dropStyle?.getPropertyValue("--drop-visual-scale") ?? "1");
    const rawTravelProgress = Number.parseFloat(dropStyle?.getPropertyValue("--drop-travel-progress") ?? "0");
    const targetMorphProgress = THREE.MathUtils.clamp(Number.isFinite(rawMorphProgress) ? rawMorphProgress : 0, 0, 1);
    const targetVisualScale = THREE.MathUtils.clamp(Number.isFinite(rawVisualScale) ? rawVisualScale : 1, 0.5, 1);
    const targetTravelProgress = THREE.MathUtils.clamp(Number.isFinite(rawTravelProgress) ? rawTravelProgress : 0, 0, 1);

    morphProgressRef.current = THREE.MathUtils.damp(morphProgressRef.current, targetMorphProgress, 11, delta);
    travelProgressRef.current = THREE.MathUtils.damp(travelProgressRef.current, targetTravelProgress, 9, delta);
    visualScaleRef.current = THREE.MathUtils.damp(visualScaleRef.current, targetVisualScale, 13, delta);
    spinRef.current = (spinRef.current + delta * (0.46 + targetTravelProgress * 0.16)) % (Math.PI * 2);

    const morph = smoothstep(morphProgressRef.current);
    const travel = travelProgressRef.current;
    const spin = spinRef.current;
    const autoSpin = spin * (0.9 - morph * 0.14);
    const breath = Math.sin(state.clock.elapsedTime * 0.42) * 0.012;

    if (groupRef.current) {
      const scale = visualScaleRef.current * (1.08 - morph * 0.07 + breath);
      groupRef.current.scale.set(scale, scale, scale);
      groupRef.current.rotation.x = -0.28 + Math.sin(spin * 0.74) * 0.055 + morph * 0.1;
      groupRef.current.rotation.y = 0.42 + autoSpin + travel * 0.18 + morph * 0.2;
      groupRef.current.rotation.z = -0.1 + Math.sin(spin * 0.38) * 0.06 + travel * 0.12;
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.32) * 0.035;
    }

    for (const material of [coreBaseMaterialRef.current, glassBackMaterialRef.current, glassHighlightMaterialRef.current, coreDepthMaterialRef.current, coreHighlightMaterialRef.current]) {
      if (!material) continue;
      material.uniforms.uTime.value = state.clock.elapsedTime;
      material.uniforms.uMorph.value = morph;
    }
  });

  return (
    <group ref={groupRef}>
      <pointLight color="#ffffff" intensity={0.32} distance={8.4} position={[-2.8, 2.4, 4.8]} />
      <pointLight color="#dff2ff" intensity={0.16} distance={8} position={[2.8, 1.8, 4.6]} />
      <pointLight color="#fff9ed" intensity={0.1} distance={6.8} position={[-2.6, -1.8, 3.4]} />
      <spotLight color="#ffffff" intensity={1.25} distance={13} angle={0.62} penumbra={1} position={[-4.2, 4.8, 6.4]} />
      <directionalLight color="#eef8ff" intensity={0.72} position={[3.2, 2.4, 5.8]} />
      <hemisphereLight color="#f9fdff" groundColor="#c9d8e8" intensity={0.38} />

      <group scale={[1.02, 1.02, 1.02]}>
        <MorphMesh data={glassData} progressRef={morphProgressRef} renderOrder={1}>
          <shaderMaterial
            ref={glassBackMaterialRef}
            uniforms={glassBackUniforms}
            vertexShader={organicVertexShader}
            fragmentShader={glassBackFragmentShader}
            transparent
            side={THREE.BackSide}
            depthWrite={false}
          />
        </MorphMesh>
      </group>

      <group scale={[1, 1, 1]}>
        <MorphMesh data={glassData} progressRef={morphProgressRef} renderOrder={2}>
          <MeshTransmissionMaterial
            color="#fbfdff"
            backside
            backsideThickness={0.035}
            chromaticAberration={0.004}
            distortion={0.015}
            distortionScale={0.035}
            temporalDistortion={0.004}
            anisotropicBlur={0.02}
            samples={8}
            resolution={384}
            transmission={1}
            thickness={0.52}
            roughness={0.003}
            ior={1.42}
            transparent
            opacity={0.004}
            depthWrite={false}
          />
        </MorphMesh>
      </group>

      <group position={[0.02, -0.03, 0.18]} rotation={[0.03, -0.06, -0.04]} scale={[1.02, 1.02, 1.02]}>
        <MorphMesh data={coreData} progressRef={morphProgressRef} renderOrder={3}>
          <shaderMaterial
            ref={coreBaseMaterialRef}
            uniforms={coreBaseUniforms}
            vertexShader={organicVertexShader}
            fragmentShader={coreBaseFragmentShader}
          />
        </MorphMesh>
        <MorphMesh data={coreData} progressRef={morphProgressRef} renderOrder={4}>
          <shaderMaterial
            ref={coreDepthMaterialRef}
            uniforms={coreDepthUniforms}
            vertexShader={organicVertexShader}
            fragmentShader={coreDepthFragmentShader}
            transparent
            side={THREE.FrontSide}
            blending={THREE.NormalBlending}
            depthTest={true}
            depthWrite={false}
          />
        </MorphMesh>
        <MorphMesh data={coreData} progressRef={morphProgressRef} renderOrder={5}>
          <shaderMaterial
            ref={coreHighlightMaterialRef}
            uniforms={coreHighlightUniforms}
            vertexShader={organicVertexShader}
            fragmentShader={coreHighlightFragmentShader}
            transparent
            side={THREE.FrontSide}
            blending={THREE.AdditiveBlending}
            depthTest={true}
            depthWrite={false}
          />
        </MorphMesh>
      </group>

      <group scale={[1.045, 1.045, 1.045]}>
        <MorphMesh data={glassData} progressRef={morphProgressRef} renderOrder={6}>
          <shaderMaterial
            ref={glassHighlightMaterialRef}
            uniforms={glassHighlightUniforms}
            vertexShader={organicVertexShader}
            fragmentShader={glassHighlightFragmentShader}
            transparent
            side={THREE.FrontSide}
            blending={THREE.AdditiveBlending}
            depthTest={true}
            depthWrite={false}
          />
        </MorphMesh>
      </group>
    </group>
  );
}

export default function HomeDropScene() {
  return (
    <Canvas
      className="home-drop-canvas"
      camera={{ position: [0, 0, 7.2], fov: 36 }}
      dpr={[1, 1.75]}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
    >
      <Environment files="/studio.hdr" background={false} />
      <ambientLight intensity={1.05} />
      <FallingGlassModel />
    </Canvas>
  );
}

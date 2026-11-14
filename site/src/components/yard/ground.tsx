import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { SURFACES, type Surface } from '@/engine/campus';
import { rampTable } from '@/engine/heat';
import { BEVEL, STRIDE } from '@/engine/surface';
import type { Yard } from './controller';
import { keep, take } from './stages';

const SHADOW = '#2b4450';
const PAPER = '#e3eaec';
const ROAD = '#d6dee1';
const YELLOW = '#e9c766';
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const spot = new THREE.Vector3();
const MASK_LIMIT = 2048;
const ALBEDO: Record<Surface, string> = {
  grass: '#b7cf9c',
  asphalt: '#b8bec1',
  concrete: '#dedcd0',
  turf: '#8cc39b',
  court: '#8db6c9',
  track: '#d0876f',
  soil: '#cbb38f',
  water: '#a8cfe0',
  roof: '#dfe3e1',
};
const SHEEN: Partial<Record<Surface, number>> = { court: 0.1, asphalt: 0.06, track: 0.05, concrete: 0.05, turf: 0.03, grass: 0.02, soil: 0, water: 0.12 };
const KINDS = (Object.keys(SURFACES) as Surface[]).sort((a, b) => SURFACES[a].code - SURFACES[b].code);

const SHADE_OPACITY = 0.26;
const SHADE_LIFT = 0.05;
const NEAR_PIXEL = 0.25;
const RIM_FAR = (BEVEL / 2) * 1.3;
const SHEEN_FROM = 0.6;
const SHEEN_TO = 1.2;

const VERTEX = `
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
attribute float aRise;
attribute float aPaved;
attribute float aLine;
attribute vec2 aOut;
attribute float aHalf;
attribute float aKind;
attribute vec2 aAlong;
attribute float aPhase;
attribute vec3 aBevel;
uniform vec4 uGrid;
uniform vec2 uMiddle;
uniform float uPixel;
varying vec2 vUv;
varying float vRise;
varying float vPaved;
varying float vLine;
varying vec2 vWorld;
varying float vKind;
varying vec3 vAlong;
varying vec3 vBevel;
varying float vInk;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float shade = 0.0;
  if (abs(aLine) > 0.5) {
    float perPixel = distance(world.xyz, cameraPosition) * uPixel;
    float wide = max(aHalf, 0.65 * perPixel);
    world.xz += aOut * wide;
    shade = clamp(aHalf / wide * 1.5, 0.3, 1.0);
  } else if (aHalf > 0.0) {
    vec2 anchor = world.xz + aOut;
    float reach = max(distance(vec3(anchor.x, 0.0, anchor.y), cameraPosition) - aHalf, 0.0);
    if (reach * uPixel > ${RIM_FAR.toFixed(4)}) world.xz = anchor;
  }
  vec2 campus = vec2(world.x + uMiddle.x, uMiddle.y - world.z);
  vUv = (campus - uGrid.xy) / uGrid.zw;
  vRise = aRise;
  vPaved = aPaved;
  vLine = shade;
  vWorld = world.xz;
  vKind = aKind;
  vAlong = vec3(aAlong, dot(world.xz, aAlong) - aPhase);
  vBevel = aBevel;
  vInk = aLine;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #ifdef GROUND_SHADOW
    vec3 lifted = mix(world.xyz, cameraPosition, ${SHADE_LIFT.toFixed(2)} / max(cameraPosition.y - world.y, 0.001));
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
        vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * vec4( lifted + vec3( 0.0, directionalLightShadows[ i ].shadowNormalBias, 0.0 ), 1.0 );
      }
      #pragma unroll_loop_end
    #endif
    #ifdef USE_FOG
      vFogDepth = - ( viewMatrix * vec4( lifted, 1.0 ) ).z;
    #endif
  #endif
}
`;

const FRAGMENT = `
#include <common>
#ifdef GROUND_SHADOW
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#endif
uniform sampler2D uHeat;
uniform sampler2D uHome;
uniform sampler2D uRamp;
uniform sampler2D uContact;
uniform float uAir;
uniform vec3 uPaper;
uniform vec3 uRoad;
uniform vec3 uSun;
uniform vec3 uEye;
uniform vec3 uShade;
uniform vec3 uYellow;
uniform vec3 uAlbedo[${KINDS.length}];
uniform float uSheen[${KINDS.length}];
varying vec2 vUv;
varying float vRise;
varying float vPaved;
varying float vLine;
varying vec2 vWorld;
varying float vKind;
varying vec3 vAlong;
varying vec3 vBevel;
varying float vInk;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

float keep(float size, float pixel) {
  return 1.0 - smoothstep(size * 0.15, size * 0.5, pixel);
}

float detail(vec2 p, float size, float offset, float pixel) {
  #ifdef GROUND_GRAIN
    if (pixel >= size * 0.5) return 0.0;
    return noise(p / size + offset) * keep(size, pixel);
  #else
    return 0.0;
  #endif
}

float joint(float coord, float pixel) {
  float d = abs(fract(coord / 1.5 + 0.5) - 0.5) * 1.5;
  float w = max(pixel, 0.001);
  return max(min(0.015, d + 0.5 * w) - max(-0.015, d - 0.5 * w), 0.0) / w;
}

float mown(vec2 p, float pixel) {
  float stripe = smoothstep(-0.3, 0.3, sin(3.14159265 * vAlong.z / 4.572)) * 2.0 - 1.0;
  return 0.035 * stripe + 0.02 * detail(p, 0.1, 0.0, pixel);
}

float grain(vec2 p, vec2 fw, float pixel) {
  float kind = floor(vKind + 0.5);
  bool aligned = dot(vAlong.xy, vAlong.xy) > 0.25;
  if (kind < 0.5) {
    if (aligned) return mown(p, pixel);
    vec2 r = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y);
    return 0.015 * detail(p, 0.7, 0.0, pixel) + 0.035 * detail(r, 5.0, 19.7, pixel);
  }
  if (kind < 1.5) {
    float fine = 0.03 * detail(p, 0.18, 0.0, pixel);
    #ifdef GROUND_GRAIN
      if (pixel >= 1.75) return fine;
      vec2 r = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y);
      return fine - 0.03 * smoothstep(-0.2, 0.7, noise(r / 3.5 + 7.3)) * keep(3.5, pixel);
    #else
      return fine;
    #endif
  }
  if (kind < 2.5) {
    float seams = 0.0;
    if (pixel < 0.75) seams = -0.07 * max(joint(p.x, fw.x), joint(p.y, fw.y)) * keep(1.5, pixel);
    return seams + 0.02 * detail(p, 0.8, 3.1, pixel);
  }
  if (kind < 3.5) return mown(p, pixel);
  if (kind < 4.5) {
    #ifdef GROUND_GRAIN
      vec2 q = aligned ? vec2(dot(p, vAlong.xy) / 9.0, dot(p, vec2(-vAlong.y, vAlong.x)) / 3.0) : p / 6.0;
      return 0.015 * noise(q + 11.0);
    #else
      return 0.0;
    #endif
  }
  if (kind < 5.5) return 0.03 * detail(p, 0.12, 0.0, pixel);
  if (kind < 6.5) return 0.025 * detail(p, 0.4, 5.0, pixel) + 0.035 * detail(p, 2.0, 13.0, pixel);
  return 0.0;
}

float relief(float pixel) {
  #ifdef GROUND_GRAIN
    if (pixel >= ${(BEVEL / 2).toFixed(4)}) return 0.0;
    float spread = dot(vBevel.xz, vBevel.xz);
    if (spread < 0.04) return 0.0;
    vec2 outward = vBevel.xz * inversesqrt(spread) * sign(vBevel.y);
    vec3 tilted = vec3(outward.x * 0.6428, 0.7660, outward.y * 0.6428);
    float level = max(uSun.y, 0.02);
    float change = clamp((max(dot(tilted, uSun), 0.0) / level - 1.0) * 2.2, -1.0, 1.0);
    float profile = smoothstep(0.0, 0.6, abs(vBevel.y));
    float low = smoothstep(0.02, 0.22, uSun.y);
    float far = 1.0 - smoothstep(${(BEVEL / 7).toFixed(4)}, ${(BEVEL / 2).toFixed(4)}, pixel);
    return 0.14 * change * profile * low * far;
  #else
    return 0.0;
  #endif
}

void main() {
  vec2 fw = fwidth(vWorld);
  float pixel = max(fw.x, fw.y);
  float home = smoothstep(0.35, 0.65, texture2D(uHome, vUv).r);
  float contact = smoothstep(0.03, 0.55, texture2D(uContact, vUv).r);
  vec3 colour = mix(uPaper, uRoad, vPaved);
  vec3 glow = vec3(0.0);
  if (home > 0.0) {
    float degrees = uAir + vRise * textureLod(uHeat, vUv, 0.0).r * 1.275;
    float place = clamp((degrees - 30.0) * 1.25 / 255.0, 0.0, 1.0);
    vec3 hot = textureLod(uRamp, vec2(place, 0.5), 0.0).rgb;
    int kind = int(clamp(floor(vKind + 0.5), 0.0, ${(KINDS.length - 1).toFixed(1)}));
    float wash = clamp(0.18 + 0.72 * smoothstep(104.0, 140.0, degrees), 0.0, 0.9);
    vec3 base = mix(uAlbedo[kind], hot, wash);
    vec3 ink = vInk > 1.5 ? uYellow : (vInk < -0.5 ? base * vec3(0.46, 0.56, 0.64) : vec3(0.98, 0.985, 0.97));
    base = mix(base, ink, vLine * home * 0.55);
    if (pixel < ${NEAR_PIXEL.toFixed(2)}) {
      float near = 1.0 - smoothstep(0.08, ${NEAR_PIXEL.toFixed(2)}, pixel);
      float tone = clamp(1.0 + grain(vWorld, fw, pixel) * near, 0.9, 1.06);
      base *= pow(tone * (1.0 + relief(pixel)), 2.2);
    }
    colour = mix(colour, base, home);
    float sheen = uSheen[kind] * (1.0 - smoothstep(${SHEEN_FROM.toFixed(2)}, ${SHEEN_TO.toFixed(2)}, pixel));
    vec3 sun = normalize(uSun);
    if (sheen > 0.0 && sun.y > 0.03) {
      vec3 viewDir = normalize(uEye - vec3(vWorld.x, 0.0, vWorld.y));
      vec3 reflected = vec3(-sun.x, sun.y, -sun.z);
      float glint = pow(max(dot(reflected, viewDir), 0.0), 18.0);
      glow = vec3(1.0, 0.97, 0.9) * glint * sheen * smoothstep(0.03, 0.3, sun.y) * home;
    }
  }
  colour = mix(colour, colour * vec3(0.72, 0.79, 0.83), 0.55 * contact) + glow;
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
  #ifdef GROUND_SHADOW
    vec2 inside = step(vec2(0.0), vUv) * step(vUv, vec2(1.0));
    float shaded = inside.x * inside.y > 0.0 ? ${SHADE_OPACITY.toFixed(2)} * (1.0 - getShadowMask()) : 0.0;
    if (shaded > 0.0) {
      vec3 tint = linearToOutputTexel(vec4(uShade, 1.0)).rgb;
      #ifdef USE_FOG
        tint = mix(tint, fogColor, smoothstep(fogNear, fogFar, vFogDepth));
      #endif
      gl_FragColor.rgb = mix(gl_FragColor.rgb, tint, shaded);
    }
  #endif
}
`;

function topFirst(values: Float32Array, used: number): Float32Array {
  const size = STRIDE * 3;
  const count = used / size;
  const out = new Float32Array(used);
  for (let index = 0; index < count; index += 1) out.set(values.subarray(index * size, index * size + size), (count - 1 - index) * size);
  return out;
}

function build(yard: Yard, stacked: boolean): THREE.BufferGeometry {
  const values = yard.paving;
  const geometry = new THREE.BufferGeometry();
  const packed = new THREE.InterleavedBuffer(stacked ? topFirst(values, values.length) : values.slice(), STRIDE);
  const layout: [string, number, number][] = [
    ['position', 3, 0],
    ['aRise', 1, 3],
    ['aPaved', 1, 4],
    ['aLine', 1, 5],
    ['aOut', 2, 6],
    ['aHalf', 1, 8],
    ['aKind', 1, 9],
    ['aAlong', 2, 10],
    ['aPhase', 1, 12],
    ['aBevel', 3, 13],
  ];
  for (const [name, size, offset] of layout) geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(packed, size, offset));
  geometry.computeBoundingSphere();
  return geometry;
}

function homeMask(yard: Yard, limit: number): THREE.CanvasTexture {
  const grid = yard.ground.grid;
  const width = grid.cols * grid.cell;
  const depth = grid.rows * grid.cell;
  const scale = Math.min(limit, MASK_LIMIT) / Math.max(width, depth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(depth * scale));
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const open = yard.campus.boundary.length === 0;
  context.fillStyle = open ? '#ffffff' : '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / width;
  const sy = canvas.height / depth;
  context.setTransform(sx, 0, 0, -sy, -grid.minX * sx, (grid.minY + depth) * sy);
  context.fillStyle = '#ffffff';
  for (const ring of yard.campus.boundary) {
    context.beginPath();
    ring.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.closePath();
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function contactMask(yard: Yard): THREE.DataTexture {
  const { cols, rows, data } = yard.contact;
  const texture = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.unpackAlignment = 1;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function groundPoint(event: ThreeEvent<PointerEvent>): THREE.Vector3 | null {
  return event.ray.intersectPlane(FLOOR, spot);
}

export function primeGround(yard: Yard, gl: THREE.WebGLRenderer): void {
  const stacked = gl.getContextAttributes()?.stencil === true;
  keep(yard, `ground ${stacked}`, () => build(yard, stacked));
}

export function Ground({ yard, texture = 4096, inert = false, grain = true }: { yard: Yard; texture?: number; inert?: boolean; grain?: boolean }) {
  const grid = yard.ground.grid;
  const width = grid.cols * grid.cell;
  const depth = grid.rows * grid.cell;
  const heat = useMemo(() => {
    const data = new Uint8Array(grid.cols * grid.rows);
    const map = new THREE.DataTexture(data, grid.cols, grid.rows, THREE.RedFormat, THREE.UnsignedByteType);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.needsUpdate = true;
    return { data, texture: map };
  }, [grid]);
  useEffect(() => () => heat.texture.dispose(), [heat]);
  const gl = useThree((state) => state.gl);
  const stacked = useMemo(() => gl.getContextAttributes()?.stencil === true, [gl]);
  const geometry = useMemo(() => take(yard, `ground ${stacked}`, () => build(yard, stacked)), [yard, stacked]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const contact = useMemo(() => contactMask(yard), [yard]);
  useEffect(() => () => contact.dispose(), [contact]);
  const material = useMemo(() => {
    const ramp = new THREE.DataTexture(rampTable(), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    ramp.colorSpace = THREE.SRGBColorSpace;
    ramp.magFilter = THREE.LinearFilter;
    ramp.minFilter = THREE.LinearFilter;
    ramp.needsUpdate = true;
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      defines: { ...(stacked ? { GROUND_SHADOW: '' } : {}), ...(grain ? { GROUND_GRAIN: '' } : {}) },
      lights: stacked,
      fog: stacked,
      stencilWrite: stacked,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
      uniforms: {
        ...(stacked ? THREE.UniformsUtils.clone({ ...THREE.UniformsLib.lights, ...THREE.UniformsLib.fog }) : {}),
        uShade: { value: new THREE.Color(SHADOW) },
        uYellow: { value: new THREE.Color(YELLOW) },
        uHeat: { value: heat.texture },
        uHome: { value: homeMask(yard, texture) },
        uRamp: { value: ramp },
        uContact: { value: contact },
        uAir: { value: 90 },
        uPaper: { value: new THREE.Color(PAPER) },
        uRoad: { value: new THREE.Color(ROAD) },
        uGrid: { value: new THREE.Vector4(grid.minX, grid.minY, width, depth) },
        uMiddle: { value: new THREE.Vector2(yard.middle[0], yard.middle[1]) },
        uPixel: { value: 0.001 },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uEye: { value: new THREE.Vector3(0, 1, 0) },
        uAlbedo: { value: KINDS.map((kind) => new THREE.Color(ALBEDO[kind])) },
        uSheen: { value: KINDS.map((kind) => SHEEN[kind] ?? 0) },
      },
    });
  }, [yard, grid, heat, contact, texture, width, depth, stacked, grain]);
  useEffect(
    () => () => {
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof THREE.Texture && uniform.value !== heat.texture && uniform.value !== contact) uniform.value.dispose();
      }
      material.dispose();
    },
    [material, heat, contact],
  );
  const seen = useRef(-1);
  const drag = useRef<{ kind: 'tree' | 'sail'; id: number } | null>(null);
  const press = useRef<{ x: number; y: number; at: number } | null>(null);
  const owner = useRef<THREE.ShaderMaterial | null>(null);
  const sunMinute = useRef(Number.NaN);
  const sunOwner = useRef<THREE.ShaderMaterial | null>(null);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const fov = camera.isPerspectiveCamera ? camera.fov : 30;
    const zoom = camera.isPerspectiveCamera ? camera.zoom : 1;
    material.uniforms.uPixel.value = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, state.gl.domElement.height * zoom);
    camera.getWorldPosition(material.uniforms.uEye.value as THREE.Vector3);
    if (sunMinute.current !== yard.minute || sunOwner.current !== material) {
      sunMinute.current = yard.minute;
      sunOwner.current = material;
      const ray = yard.sun();
      (material.uniforms.uSun.value as THREE.Vector3).set(ray.x, ray.z, -ray.y);
    }
    if (seen.current === yard.frame && owner.current === material) return;
    seen.current = yard.frame;
    owner.current = material;
    material.uniforms.uAir.value = yard.fillHeat(heat.data);
    heat.texture.needsUpdate = true;
    state.gl.initTexture(heat.texture);
  });

  const [cx, , cz] = yard.toScene(grid.minX + width / 2, grid.minY + depth / 2);

  const down = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || yard.tool === 'look') {
      if (event.button === 0) {
        yard.select(null);
        press.current = { x: event.clientX, y: event.clientY, at: performance.now() };
      }
      return;
    }
    const point = groundPoint(event);
    if (!point) return;
    event.stopPropagation();
    const [x, y] = yard.fromScene(point.x, point.z);
    if (yard.tool === 'measure') {
      yard.ask(x, y);
      return;
    }
    const kind = yard.tool;
    const [atX, atY] = (kind === 'tree' ? yard.treeOnRay(event.ray.origin, event.ray.direction) : null) ?? [x, y];
    const id = kind === 'tree' ? yard.plant(atX, atY) : yard.startSail(x, y);
    if (id === null) return;
    drag.current = { kind, id };
    yard.setBusy(true);
    if (controls) controls.enabled = false;
    (event.target as Element).setPointerCapture(event.pointerId);
  };

  const move = (event: ThreeEvent<PointerEvent>) => {
    const point = groundPoint(event);
    if (!point) return;
    event.stopPropagation();
    const [x, y] = yard.fromScene(point.x, point.z);
    if (drag.current) {
      if (drag.current.kind === 'tree') yard.moveTree(drag.current.id, x, y);
      else yard.stretchSail(drag.current.id, x, y);
      yard.probeAt(x, y);
      return;
    }
    if (yard.busy) return;
    if (yard.tool === 'tree') {
      const [atX, atY] = yard.treeOnRay(event.ray.origin, event.ray.direction) ?? [x, y];
      yard.hint(atX, atY);
    }
    yard.probeAt(x, y);
  };

  const up = (event: ThreeEvent<PointerEvent>) => {
    const pressed = press.current;
    press.current = null;
    if (!drag.current && pressed && yard.tool === 'look') {
      const still = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 6 && performance.now() - pressed.at < 450;
      const point = still ? groundPoint(event) : null;
      if (point) {
        const [x, y] = yard.fromScene(point.x, point.z);
        yard.pickPatch(x, y);
      }
      return;
    }
    if (!drag.current) return;
    event.stopPropagation();
    if (drag.current.kind === 'sail') yard.endSail(drag.current.id);
    else yard.commit();
    drag.current = null;
    yard.setBusy(false);
    if (controls) controls.enabled = true;
    (event.target as Element).releasePointerCapture(event.pointerId);
  };

  return (
    <group>
      <mesh name="ground" geometry={geometry} material={material} renderOrder={1} receiveShadow={stacked} raycast={() => null} />
      <group position={[cx, 0, cz]}>
        <mesh {...(inert ? { raycast: () => null } : {})} rotation-x={-Math.PI / 2} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => !drag.current && yard.clearProbe()}>
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial visible={false} />
        </mesh>
        {!stacked && (
          <mesh name="shade" rotation-x={-Math.PI / 2} position-y={SHADE_LIFT} receiveShadow raycast={() => null}>
            <planeGeometry args={[width, depth]} />
            <shadowMaterial color={SHADOW} opacity={SHADE_OPACITY} />
          </mesh>
        )}
      </group>
    </group>
  );
}

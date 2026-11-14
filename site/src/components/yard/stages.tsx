import { useThree } from '@react-three/fiber';
import { Children, useEffect, useRef, useState, type DependencyList, type ReactNode } from 'react';
import { BackSide, DoubleSide, FrontSide, MeshDepthMaterial, PCFShadowMap, PCFSoftShadowMap, WebGLRenderTarget } from 'three';
import type * as THREE from 'three';
import type { Kind, Library } from './library';

type Yielding = { yield?: () => Promise<void> };

export function nextTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Yielding }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function warm(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, live: () => boolean): Promise<void> {
  for (const child of [...scene.children]) {
    if (!live()) return;
    if (gl.shadowMap.type === PCFSoftShadowMap) gl.shadowMap.type = PCFShadowMap;
    gl.compile(child, camera, scene);
    await nextTask();
  }
  if (!live()) return;
  await gl.compileAsync(scene, camera);
  const programs = gl.info.programs ?? [];
  for (let index = 0; index < programs.length; index += 1) {
    if (!live()) return;
    programs[index].getUniforms();
    programs[index].getAttributes();
    if (index % 4 === 3) await nextTask();
  }
}

const early = new WeakMap<object, Map<string, unknown>>();

export function keep<T>(owner: object, name: string, make: () => T): void {
  let box = early.get(owner);
  if (!box) {
    box = new Map();
    early.set(owner, box);
  }
  if (!box.has(name)) box.set(name, make());
}

export function take<T>(owner: object, name: string, make: () => T): T {
  const box = early.get(owner);
  if (box && box.has(name)) {
    const value = box.get(name) as T;
    box.delete(name);
    return value;
  }
  return make();
}

export function Prime({ run }: { run: (gl: THREE.WebGLRenderer) => void }) {
  const gl = useThree((state) => state.gl);
  useState(() => {
    run(gl);
    return true;
  });
  return null;
}

export function Stages({ children, onReady }: { children: ReactNode; onReady: () => void }) {
  const parts = Children.toArray(children);
  const total = parts.length;
  const [count, setCount] = useState(1);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const frameloop = useThree((state) => state.frameloop);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    let live = true;
    if (count < total) {
      void nextTask().then(() => {
        if (live) setCount((value) => value + 1);
      });
    } else {
      void warm(gl, scene, camera, () => live)
        .catch(() => undefined)
        .then(() => {
          if (live) onReady();
        });
    }
    return () => {
      live = false;
    };
  }, [count, total, gl, scene, camera]);

  useEffect(() => {
    if (frameloop !== 'never') invalidate();
  }, [frameloop, invalidate]);

  return <>{parts.slice(0, count)}</>;
}

type Held = { object: THREE.Object3D; dispose: () => void };
type Pause = () => Promise<void>;

const FLIPPED: Record<number, THREE.Side> = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };
let target: WebGLRenderTarget | null = null;

function standIn(material: THREE.Material): THREE.MeshDepthMaterial {
  const source = material as THREE.MeshStandardMaterial;
  const depth = new MeshDepthMaterial();
  depth.map = source.map;
  depth.alphaMap = source.alphaMap;
  depth.alphaTest = source.alphaToCoverage ? 0.5 : source.alphaTest;
  depth.side = source.shadowSide ?? FLIPPED[source.side];
  return depth;
}

async function warmUp(gl: THREE.WebGLRenderer, object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene, extras: THREE.Material[]): Promise<void> {
  const maps = new Set<THREE.Texture>();
  const casters: THREE.Mesh[] = [];
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const map = (mesh.material as THREE.MeshStandardMaterial).map;
    if (map) maps.add(map);
    if (mesh.castShadow) casters.push(mesh);
  });
  for (const map of maps) {
    gl.initTexture(map);
    await nextTask();
  }
  await gl.compileAsync(object, camera, scene);
  if (gl.shadowMap.enabled && casters.length > 0) {
    target ??= new WebGLRenderTarget(1, 1);
    const before = gl.getRenderTarget();
    const waits: Promise<unknown>[] = [];
    gl.setRenderTarget(target);
    for (const mesh of casters) {
      const own = mesh.material;
      const depth = standIn(own as THREE.Material);
      extras.push(depth);
      mesh.material = depth;
      waits.push(gl.compileAsync(mesh, camera, scene));
      mesh.material = own;
    }
    gl.setRenderTarget(before);
    await Promise.all(waits);
  }
  const programs = gl.info.programs ?? [];
  for (const program of programs) {
    await nextTask();
    program.getUniforms();
    program.getAttributes();
  }
}

export function useCrowd<T extends Held | null>(make: () => T, deps: DependencyList, slow?: (pause: Pause) => Promise<T>, urgent: unknown = null): T {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const [held, setHeld] = useState<{ value: T; urgent: unknown }>(() => ({ value: make(), urgent }));
  const turn = useRef(0);
  let now = held;
  if (held.urgent !== urgent) {
    now = { value: make(), urgent };
    turn.current += 1;
    setHeld(now);
  }
  const shown = useRef<T>(now.value);
  const first = useRef(true);
  const extras = useRef(new Map<Held, THREE.Material[]>());
  const drop = (value: T) => {
    if (!value) return;
    value.dispose();
    for (const material of extras.current.get(value) ?? []) material.dispose();
    extras.current.delete(value);
  };
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let live = true;
    const start = turn.current;
    void (async () => {
      await nextTask();
      if (!live || turn.current !== start) return;
      const next = slow ? await slow(nextTask) : make();
      const spare: THREE.Material[] = [];
      if (next) {
        extras.current.set(next, spare);
        if (live) await warmUp(gl, next.object, camera, scene, spare).catch(() => undefined);
      }
      if (!live || turn.current !== start) {
        drop(next);
        return;
      }
      setHeld((old) => ({ value: next, urgent: old.urgent }));
      invalidate();
    })();
    return () => {
      live = false;
    };
  }, deps);
  useEffect(() => {
    const previous = shown.current;
    shown.current = held.value;
    if (previous !== held.value) drop(previous);
  }, [held]);
  useEffect(() => () => drop(shown.current), []);
  return now.value;
}

export function useSettled<L extends Library | null>(library: L, kinds: readonly Kind[]): L {
  const key = kinds.map((kind) => (library?.full.has(kind) ? 'full' : library?.kinds.has(kind) ? 'far' : 'none')).join(' ');
  const held = useRef({ key, library });
  if (held.current.key !== key) held.current = { key, library };
  return held.current.library;
}

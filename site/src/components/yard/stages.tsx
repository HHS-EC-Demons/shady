import { useThree } from '@react-three/fiber';
import { Children, useEffect, useState, type ReactNode } from 'react';
import { PCFShadowMap, PCFSoftShadowMap } from 'three';
import type * as THREE from 'three';

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

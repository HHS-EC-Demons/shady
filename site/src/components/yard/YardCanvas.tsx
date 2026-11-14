import { PerformanceMonitor } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useState, type RefObject } from 'react';
import type { Yard } from './controller';
import { peekLibrary, releaseLibrary, type Library } from './library';
import { TIERS, keepFrame, powerChoice, quality, type Tier } from './quality';
import { Scene, useLibrary } from './Scene';

type Props = { yard: Yard; layer: RefObject<HTMLDivElement | null>; tier: Tier; drawn: boolean; conifers: boolean; onReady: () => void };

export function useAntialias(tier: Tier): boolean {
  const [smooth, setSmooth] = useState(() => TIERS[tier].antialias);
  if (quality.chosen && TIERS[tier].antialias !== smooth) setSmooth(TIERS[tier].antialias);
  return smooth;
}

export default function YardCanvas(props: Props) {
  const antialias = useAntialias(props.tier);
  useEffect(() => () => releaseLibrary(peekLibrary(true) ?? peekLibrary(false)), []);
  return <Surface key={antialias ? 'smooth' : 'sharp'} {...props} antialias={antialias} />;
}

function Surface({ yard, layer, tier, drawn, conifers, antialias, onReady }: Props & { antialias: boolean }) {
  const library: Library | null = useLibrary(conifers);
  const [ready, setReady] = useState(false);
  return (
    <Canvas
      shadows
      flat
      frameloop={drawn && ready ? 'demand' : 'never'}
      dpr={[1, TIERS[tier].dpr]}
      camera={{ fov: 30, near: 5, far: 9000, position: [-300, 420, 600] }}
      gl={{ antialias, stencil: true, preserveDrawingBuffer: keepFrame(), powerPreference: powerChoice() }}
      style={{ position: 'absolute', inset: 0, cursor: yard.tool === 'look' ? undefined : 'crosshair' }}
      aria-hidden="true"
    >
      <PerformanceMonitor onDecline={() => quality.lower()} />
      <Scene
        yard={yard}
        layer={layer}
        shadow={TIERS[tier].shadow}
        texture={TIERS[tier].texture}
        props={TIERS[tier].props}
        standing={TIERS[tier].standing}
        grain={TIERS[tier].grain}
        library={library}
        levels={TIERS[tier].levels}
        onReady={() => {
          setReady(true);
          onReady();
        }}
      />
    </Canvas>
  );
}

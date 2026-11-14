import { PerformanceMonitor } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { RefObject } from 'react';
import type { Yard } from './controller';
import { TIERS, keepFrame, powerChoice, quality, type Tier } from './quality';
import { Scene } from './Scene';

type Props = { yard: Yard; layer: RefObject<HTMLDivElement | null>; tier: Tier; drawn: boolean; onReady: () => void };

export default function YardCanvas({ yard, layer, tier, drawn, onReady }: Props) {
  return (
    <Canvas
      shadows
      flat
      frameloop={drawn ? 'demand' : 'never'}
      dpr={[1, TIERS[tier].dpr]}
      camera={{ fov: 30, near: 5, far: 9000, position: [-300, 420, 600] }}
      gl={{ stencil: true, preserveDrawingBuffer: keepFrame(), powerPreference: powerChoice() }}
      style={{ position: 'absolute', inset: 0, cursor: yard.tool === 'look' ? undefined : 'crosshair' }}
      aria-hidden="true"
    >
      <PerformanceMonitor onDecline={() => quality.lower()} />
      <Scene yard={yard} layer={layer} shadow={TIERS[tier].shadow} texture={TIERS[tier].texture} props={TIERS[tier].props} standing={TIERS[tier].standing} grain={TIERS[tier].grain} onReady={onReady} />
    </Canvas>
  );
}

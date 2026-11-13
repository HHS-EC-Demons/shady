import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { useRef, useState, useSyncExternalStore } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Found } from '@/engine/osm';
import { quality, type Tier } from '../yard/quality';
import { SchoolPicker } from '../yard/SchoolPicker';

export function FindSchool({ base }: { base: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const go = (found: Found | null) => {
    const target = found ? `${base}yard/?school=${encodeURIComponent(JSON.stringify(found))}` : `${base}yard/`;
    window.location.assign(target);
  };
  return (
    <>
      <button ref={button} type="button" className="pill pill-light" onClick={() => setOpen(true)}>
        <MagnifyingGlassIcon aria-hidden="true" weight="bold" />
        Find your school
      </button>
      <SchoolPicker open={open} onOpenChange={setOpen} onPick={go} home="Heritage High School" status="" note="" returnTo={button} />
    </>
  );
}

export function Detail() {
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot, quality.server);
  return (
    <ToggleGroup type="single" variant="outline" size="lg" spacing={0} value={tier} onValueChange={(value) => value && quality.choose(value as Tier)} aria-label="3D detail" className="bg-raised">
      <ToggleGroupItem value="high" className="h-11 px-3.5 text-[0.9375rem]">
        High
      </ToggleGroupItem>
      <ToggleGroupItem value="medium" className="h-11 px-3.5 text-[0.9375rem]">
        Medium
      </ToggleGroupItem>
      <ToggleGroupItem value="low" className="h-11 px-3.5 text-[0.9375rem]">
        Low
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

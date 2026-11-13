import { useEffect, useRef, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { districtSearch, rankDistricts } from '@/engine/district';
import type { Found, PhotonFeature } from '@/engine/osm';
import { cn } from '@/lib/utils';

type Props = { value: string; onPick: (place: Found) => void; autoFocus?: boolean; className?: string };

async function findDistricts(text: string, signal: AbortSignal): Promise<Found[]> {
  const control = new AbortController();
  const stop = () => control.abort();
  signal.addEventListener('abort', stop, { once: true });
  const timer = window.setTimeout(stop, 7000);
  try {
    const answer = await fetch(districtSearch(text), { signal: control.signal });
    if (!answer.ok) throw new Error(`The search did not answer (${answer.status})`);
    const body = (await answer.json()) as { features?: PhotonFeature[] };
    return rankDistricts(Array.isArray(body.features) ? body.features : []);
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

export function Search({ value, onPick, autoFocus = false, className }: Props) {
  const [text, setText] = useState(value);
  const [found, setFound] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const turn = useRef(0);
  const query = text.trim();

  useEffect(() => {
    if (!open || query.length < 3 || query === value) {
      setFound([]);
      setSearching(false);
      return;
    }
    const mine = turn.current + 1;
    turn.current = mine;
    setSearching(true);
    setFailed(false);
    const stop = new AbortController();
    const wait = window.setTimeout(() => {
      findDistricts(query, stop.signal)
        .then((list) => {
          if (turn.current !== mine) return;
          setFound(list);
          setSearching(false);
        })
        .catch(() => {
          if (turn.current !== mine || stop.signal.aborted) return;
          setFailed(true);
          setSearching(false);
        });
    }, 380);
    return () => {
      window.clearTimeout(wait);
      stop.abort();
    };
  }, [query, open, value]);

  const empty = failed ? 'The search did not answer. Try again.' : searching ? 'Searching' : 'No place found';
  const shown = open && query.length >= 3 && query !== value;

  return (
    <Command
      shouldFilter={false}
      label="City or district"
      className={cn(
        'relative h-auto overflow-visible rounded-none! bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group]]:h-12! [&_[data-slot=input-group]]:rounded-full! [&_[data-slot=input-group]]:border-[var(--edge)]! [&_[data-slot=input-group]]:bg-raised! [&_[data-slot=input-group]]:shadow-[var(--lift)]! [&_[data-slot=input-group-addon]]:pointer-events-none [&_[data-slot=input-group-addon]]:absolute [&_[data-slot=input-group-addon]]:left-2.5 [&_[data-slot=input-group-addon]]:z-10',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <CommandInput
        value={text}
        autoFocus={autoFocus}
        onValueChange={(next) => {
          setText(next);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        placeholder="City or district"
        aria-label="City or district"
        className="h-12 rounded-full pl-10! pr-5 text-base placeholder:text-soft"
      />
      <CommandList
        className={cn('absolute inset-x-0 top-full z-30 mt-2 max-h-[340px] rounded-xl border border-rule bg-raised p-1 shadow-[0_8px_24px_rgba(18,38,28,0.22)]', !shown && 'hidden')}
        onMouseDown={(event) => event.preventDefault()}
      >
        {shown && <CommandEmpty className="py-6 text-center text-base text-soft">{empty}</CommandEmpty>}
        {shown && !searching && found.length > 0 && (
          <CommandGroup>
            {found.map((place) => (
              <CommandItem
                key={`${place.kind} ${place.id}`}
                value={`${place.kind} ${place.id}`}
                onSelect={() => {
                  setText(place.name);
                  setOpen(false);
                  onPick(place);
                }}
                className="min-h-11 cursor-pointer text-base"
              >
                <span className="flex min-w-0 flex-col leading-snug">
                  <span className="font-medium">{place.name}</span>
                  <span className="text-soft">{place.place}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

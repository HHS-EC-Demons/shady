import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { findPlaces, type Found } from '@/engine/osm';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (found: Found | null) => void;
  home: string;
  status: string;
  note: string;
  onRetry?: () => void;
  returnTo: RefObject<HTMLButtonElement | null>;
};

export function SchoolPicker({ open, onOpenChange, onPick, home, status, note, onRetry, returnTo }: Props) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const turn = useRef(0);

  useEffect(() => {
    const query = text.trim();
    if (query.length < 3) {
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
      findPlaces(query, stop.signal)
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
  }, [text]);

  const empty = failed ? 'The search did not answer. Try again.' : searching ? 'Searching' : text.trim().length < 3 ? 'Type a school name' : 'No school found';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[22%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnTo.current?.focus();
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Find a school</DialogTitle>
          <DialogDescription>Search for any school to load its campus</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          className="bg-raised [&_[data-slot=command-input-wrapper]]:p-2 [&_[data-slot=command-input-wrapper]]:pb-1 [&_[data-slot=input-group]]:h-12! [&_[data-slot=input-group-addon]]:pointer-events-none [&_[data-slot=input-group-addon]]:absolute [&_[data-slot=input-group-addon]]:left-1 [&_[data-slot=input-group-addon]]:z-10"
        >
          <CommandInput value={text} onValueChange={setText} placeholder="School or address" disabled={status !== ''} className="h-12 rounded-lg pl-9! text-base placeholder:text-soft" />
          {(status !== '' || note !== '') && (
            <div className="flex min-h-[3.25rem] items-center justify-between gap-3 border-b border-rule px-4 py-1.5">
              <p role="status" className="py-1.5 text-base font-medium">
                {status !== '' ? status : note}
              </p>
              {status === '' && onRetry && (
                <Button size="lg" className="h-11 shrink-0 rounded-full px-5 text-base" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </div>
          )}
          <CommandList className="max-h-[340px]">
            {status === '' && note === '' && <CommandEmpty className="py-6 text-center text-base text-soft">{empty}</CommandEmpty>}
            {status === '' && found.length > 0 && (
              <CommandGroup>
                {found.map((school) => (
                  <CommandItem key={`${school.kind} ${school.id}`} value={`${school.kind} ${school.id}`} onSelect={() => onPick(school)} className="min-h-11 cursor-pointer text-base">
                    <span className="flex min-w-0 flex-col leading-snug sm:flex-row sm:flex-wrap sm:gap-x-2">
                      <span className="font-medium">{school.name}</span>
                      <span className="text-soft">{school.place}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {status === '' && found.length === 0 && text.trim().length < 3 && (
              <CommandGroup>
                <CommandItem value="home" onSelect={() => onPick(null)} className="min-h-11 cursor-pointer text-base">
                  <span className="font-medium">{home}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

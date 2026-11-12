import { useEffect, useRef, useState, type RefObject } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { findSchools, type Found } from '@/engine/osm';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (found: Found | null) => void;
  home: string;
  status: string;
  note: string;
  returnTo: RefObject<HTMLButtonElement | null>;
};

export function SchoolPicker({ open, onOpenChange, onPick, home, status, note, returnTo }: Props) {
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
      findSchools(query, stop.signal)
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
        <Command shouldFilter={false} className="bg-raised">
          <CommandInput value={text} onValueChange={setText} placeholder="Find a school" disabled={status !== ''} className="h-12 text-base placeholder:text-soft" />
          {(status !== '' || note !== '') && (
            <p role="status" className="border-b border-rule px-4 py-3 text-base font-medium">
              {status !== '' ? status : note}
            </p>
          )}
          <CommandList className="max-h-[340px]">
            {status === '' && note === '' && <CommandEmpty className="py-6 text-center text-base text-soft">{empty}</CommandEmpty>}
            {status === '' && found.length > 0 && (
              <CommandGroup>
                {found.map((school) => (
                  <CommandItem key={`${school.kind} ${school.id}`} value={`${school.kind} ${school.id}`} onSelect={() => onPick(school)} className="min-h-11 cursor-pointer text-base">
                    <span className="font-medium">{school.name}</span>
                    <span className="text-soft">{school.place}</span>
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

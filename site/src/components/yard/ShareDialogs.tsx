import { useRef, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function OpenShared({ open, onChoose }: { open: boolean; onChoose: (take: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onChoose(false)}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="gap-6 bg-raised p-6 sm:max-w-sm">
        <DialogTitle className="text-[1.375rem] font-semibold leading-tight">Open the shared plan</DialogTitle>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="outline" size="lg" className="h-11 rounded-full px-5 text-base" onClick={() => onChoose(false)}>
            Keep mine
          </Button>
          <Button size="lg" className="h-11 rounded-full px-5 text-base" onClick={() => onChoose(true)}>
            Open it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type BoxProps = { open: boolean; onOpenChange: (open: boolean) => void; link: string; returnTo: RefObject<HTMLButtonElement | null> };

export function LinkBox({ open, onOpenChange, link, returnTo }: BoxProps) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="bg-raised p-5 pr-12 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          field.current?.focus();
          field.current?.select();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnTo.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Copy link</DialogTitle>
        <Input ref={field} readOnly value={link} aria-label="Link to this plan" onFocus={(event) => event.currentTarget.select()} className="data h-11 bg-white text-[0.9375rem]" />
      </DialogContent>
    </Dialog>
  );
}

import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Coffee, Heart, X } from 'lucide-react';

export default function KofiDialog({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm text-center" hideClose>
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Coffee className="w-7 h-7 text-primary" />
          </div>

          <div className="space-y-1.5">
            <h2 className="font-heading font-bold text-lg">Enjoying LayerStencil?</h2>
            <p className="text-sm text-muted-foreground font-body leading-relaxed">
              If this tool saved you time, consider buying me a coffee — it helps keep the project alive and free!
            </p>
          </div>

          <div className="flex flex-col gap-2 w-full">
            <a
              href="https://ko-fi.com/wickedpaint"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onOpenChange(false)}
            >
              <Button className="w-full gap-2">
                <Coffee className="w-4 h-4" />
                Buy me a coffee ☕
              </Button>
            </a>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs text-muted-foreground"
            >
              Maybe later
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground font-body flex items-center gap-1">
            <Heart className="w-3 h-3 text-primary" />
            Made with love for the street art community
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
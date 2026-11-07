import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * Development-only inspector for the Cartoon V2 pipeline. Every tile is the
 * real output of that stage, spatially subsampled so large images stay viewable.
 */
export default function CartoonDebugDialog({ open, onOpenChange, stages = [], quality = null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-heading">Cartoon V2 — processing stages</DialogTitle>
          <DialogDescription className="font-body text-xs leading-relaxed">
            Actual stage output, downsampled for inspection.
            {quality && (
              <span className="block mt-1 text-[11px]">
                Quality: <strong>{quality.level}</strong> · noise {quality.noise.toFixed(1)} · blockiness{' '}
                {quality.blockiness.toFixed(1)} · edge density {(quality.edgeDensity * 100).toFixed(1)}% ·
                sharpness {quality.sharpness.toFixed(2)}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {stages.map((stage) => (
              <div key={stage.key} className="rounded-xl border border-border overflow-hidden bg-card">
                <div className="px-2.5 py-1.5 text-[11px] font-heading font-semibold border-b border-border">
                  {stage.label}
                </div>
                <img src={stage.dataUrl} alt={stage.label} className="w-full h-auto block bg-white" />
                <div className="px-2.5 py-1 text-[10px] text-muted-foreground font-body">
                  {stage.width}×{stage.height}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
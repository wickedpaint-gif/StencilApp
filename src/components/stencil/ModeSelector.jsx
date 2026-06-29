import React from 'react';
import { motion } from 'framer-motion';
import { Camera, Palette } from 'lucide-react';

const modes = [
{
  id: 'realistic',
  label: 'Realistic',
  icon: Camera,
  desc: 'Tonal layers stacked like a cake. Best for photos & portraits.'
},
{
  id: 'cartoon',
  label: 'Cartoon',
  icon: Palette,
  desc: 'Separated by color. Best for illustrations & flat artwork.'
}];

export default function ModeSelector({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {modes.map((mode) => {
        const Icon = mode.icon;
        const active = value === mode.id;
        return (
          <button
            key={mode.id}
            onClick={() => onChange(mode.id)}
            className={`
              relative rounded-xl border-2 p-3 text-left transition-all duration-200
              ${active ?
            'border-primary bg-primary/5' :
            'border-border hover:border-primary/30 hover:bg-muted/40'}
            `
            }>
            
            {active &&
            <motion.div
              layoutId="mode-indicator"
              className="absolute inset-0 rounded-[10px] bg-primary/5"
              transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }} />

            }
            <div className="relative">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <p className={`text-xs font-heading font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                {mode.label}
              </p>
              

              
            </div>
          </button>);

      })}
    </div>);

}
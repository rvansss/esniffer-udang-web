import React from 'react';

interface SensorCardProps {
  imageSrc: string;
  name: string;
  compound: string;
  dotColorClass: string;
  compoundColorClass: string;
}

export default function SensorCard({ imageSrc, name, compound, dotColorClass, compoundColorClass }: SensorCardProps) {
  return (
    <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-4 flex flex-col items-center text-center shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/15 transition-all">
      <div className="w-25 h-25 relative rounded-xl overflow-hidden mb-3 border border-white/20 bg-black/20 p-1">
        <img src={imageSrc} alt={`${name} Sensor`} className="w-full h-full object-cover rounded-lg" />
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2.5 h-2.5 rounded-full ${dotColorClass}`}></span>
        <span className="font-black text-sm font-mono text-white tracking-wider">{name}</span>
      </div>
      <span className={`text-[11px] font-mono ${compoundColorClass} font-semibold uppercase tracking-wide`}>
        {compound}
      </span>
    </div>
  );
}
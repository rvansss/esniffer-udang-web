import React from 'react';

export interface SensorCardProps {
  imageSrc: string;
  name: string;
  compound?: string;
  value?: number | string | null;
  unit?: string;
  quality?: string | null;
  dotColorClass: string;
  compoundColorClass: string;
}

export default function SensorCard({
  imageSrc,
  name,
  compound,
  value,
  unit,
  quality,
  dotColorClass,
  compoundColorClass,
}: SensorCardProps) {
  // Determine display value: null/undefined renders as '--'
  const hasExplicitValue = value !== undefined;
  const displayVal =
    value === null || value === undefined
      ? '--'
      : typeof value === 'number'
      ? value.toFixed(2)
      : value;

  const renderQualityBadge = () => {
    if (!quality || quality === 'OK') return null;
    return (
      <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-widest font-semibold mt-1">
        {quality}
      </span>
    );
  };

  return (
    <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-4 flex flex-col items-center text-center shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/15 transition-all">
      <div className="w-20 h-20 relative rounded-xl overflow-hidden mb-3 border border-white/20 bg-black/20 p-1 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={`${name} Sensor`}
          className="w-full h-full object-cover rounded-lg"
          onError={(e) => {
            // fallback icon if image isn't found
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
      </div>

      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2.5 h-2.5 rounded-full ${dotColorClass}`} />
        <span className="font-black text-sm font-mono text-white tracking-wider">{name}</span>
      </div>

      {hasExplicitValue ? (
        <div className="flex flex-col items-center">
          <div className="flex items-baseline gap-1">
            <span className="text-base font-black font-mono text-white">
              {displayVal}
            </span>
            {unit && (
              <span className={`text-xs font-mono font-semibold uppercase ${compoundColorClass}`}>
                {unit}
              </span>
            )}
          </div>
          {compound && (
            <span className="text-[10px] font-mono text-white/60 tracking-wider">
              {compound}
            </span>
          )}
          {renderQualityBadge()}
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <span className={`text-[11px] font-mono ${compoundColorClass} font-semibold uppercase tracking-wide`}>
            {compound}
          </span>
          {renderQualityBadge()}
        </div>
      )}
    </div>
  );
}
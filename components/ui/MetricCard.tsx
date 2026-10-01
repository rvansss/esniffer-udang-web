import React from 'react';

export interface MetricCardProps {
  title: React.ReactNode;
  value: string | number | null | undefined;
  unit?: string;
  subtitle?: string;
  isPrimary?: boolean;
  quality?: string | null;
  badge?: React.ReactNode;
}

export default function MetricCard({
  title,
  value,
  unit,
  subtitle,
  isPrimary = false,
  quality,
  badge,
}: MetricCardProps) {
  // Format null / undefined as '--' placeholder, NEVER 0
  const displayValue =
    value === null || value === undefined || value === ''
      ? '--'
      : typeof value === 'number'
      ? value.toFixed(1)
      : value;

  const getQualityBadge = (q: string | null | undefined) => {
    if (!q || q === 'OK') return null;
    if (q === 'OUT_OF_RANGE') {
      return (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold uppercase tracking-wider">
          Range Warn
        </span>
      );
    }
    if (q === 'SENSOR_ERROR' || q === 'DISCONNECTED') {
      return (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold uppercase tracking-wider">
          Error
        </span>
      );
    }
    return (
      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/60 border border-white/10 uppercase tracking-wider">
        {q}
      </span>
    );
  };

  return (
    <div
      className={`flex-1 backdrop-blur-lg rounded-2xl p-6 flex flex-col relative shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${
        isPrimary
          ? 'bg-white/10 border border-white/20 text-white'
          : 'bg-white/5 border border-white/10 justify-center'
      }`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="text-[11px] font-bold font-mono tracking-wide uppercase leading-tight text-white/70">
          {title}
        </div>
        <div className="flex items-center gap-1.5">
          {badge}
          {getQualityBadge(quality)}
        </div>
      </div>

      <div className={`flex items-baseline justify-center gap-1.5 my-auto ${isPrimary ? 'py-4' : 'py-2'}`}>
        <span className="text-4xl md:text-5xl font-black font-mono drop-shadow-lg text-white tracking-tight">
          {displayValue}
        </span>
        {unit && (
          <span className="text-lg md:text-xl font-bold font-mono text-cyan-300/80 drop-shadow">
            {unit}
          </span>
        )}
      </div>

      {subtitle && (
        <p className="text-white/60 text-xs font-bold font-mono text-right mt-auto">
          {subtitle}
        </p>
      )}
    </div>
  );
}
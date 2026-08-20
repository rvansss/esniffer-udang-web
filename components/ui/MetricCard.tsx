import React from 'react';

// Mendefinisikan tipe data props yang diterima komponen
interface MetricCardProps {
  title: React.ReactNode;
  value: string;
  subtitle?: string;
  isPrimary?: boolean;
}

export default function MetricCard({ title, value, subtitle, isPrimary = false }: MetricCardProps) {
  return (
    <div className={`flex-1 backdrop-blur-lg rounded-2xl p-6 flex flex-col relative shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] ${
      isPrimary 
        ? 'bg-white/10 border border-white/20 text-white' 
        : 'bg-white/5 border border-white/10 justify-center'
    }`}>
      {isPrimary && (
        <p className="text-[10px] font-bold font-mono tracking-wide uppercase leading-tight text-white/70">
          {title}
        </p>
      )}
      
      <div className={`flex items-center justify-center ${isPrimary ? 'flex-1' : 'h-full'}`}>
        <span className="text-5xl font-black font-mono drop-shadow-lg text-white">{value}</span>
      </div>
      
      {subtitle && (
        <p className="text-white/70 text-xs font-bold font-mono absolute bottom-4 right-4">
          {subtitle}
        </p>
      )}
    </div>
  );
}
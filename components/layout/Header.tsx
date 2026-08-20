import React from 'react';

export default function Header() {
  return (
    <header className="relative z-10 flex justify-between items-center px-8 py-5 mx-6 mt-6 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]">
      <h1 className="text-2xl font-mono text-white tracking-widest font-black drop-shadow-md">
        E-Sniffer
      </h1>
      
      <div className="flex p-1 rounded-xl bg-black/20 border border-white/10 backdrop-blur-md">
        <button className="px-6 py-2 bg-white/20 text-white rounded-lg shadow-sm font-semibold text-sm border border-white/20 transition-all">
          Chamber 1
        </button>
        <button className="px-6 py-2 text-white/60 font-semibold text-sm hover:text-white transition-colors">
          Chamber 2
        </button>
      </div>
      
      <div className="text-white/80 font-mono text-lg tracking-widest font-bold">
        P1 / P2 / P3
      </div>
    </header>
  );
}
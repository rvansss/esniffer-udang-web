import React from 'react';

export default function ExportPanel() {
  return (
    <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-6 flex flex-col items-center justify-center gap-8 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/20 cursor-pointer transition-all duration-300 group">
      <h2 className="text-3xl font-black text-white/90 text-center uppercase tracking-wider leading-tight drop-shadow-md">
        Ringkasan<br/>Tabel CSV
      </h2>
      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white/80 group-hover:scale-110 group-hover:text-white transition-all duration-300 drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
      </svg>
    </div>
  );
}
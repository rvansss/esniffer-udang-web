import React from 'react';

export default function Dashboard() {
  return (
    /* Background Utama - Menggunakan gradien gelap agar efek kaca bersinar */
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#1e3a8a] to-indigo-950 flex flex-col font-sans relative overflow-hidden">
      
      Elemen Cahaya Dekoratif di Background (Orb)
      <div className="absolute top-0 left-20 w-96 h-96 bg-blue-500 rounded-full mix-blend-screen filter blur-[120px] opacity-40 animate-pulse"></div>
      <div className="absolute bottom-10 right-20 w-96 h-96 bg-cyan-400 rounded-full mix-blend-screen filter blur-[120px] opacity-20"></div>

      {/* 1. Header / Navbar (Efek Kaca) */}
      {/* Perhatikan penambahan mx-6 mt-6 agar headernya melayang (floating) seperti kapsul */}
      <header className="relative z-10 flex justify-between items-center px-8 py-5 mx-6 mt-6 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]">
        
        {/* Logo E-Sniffer */}
        <h1 className="text-2xl font-mono text-white tracking-widest font-black drop-shadow-md">
          E-Sniffer
        </h1>
        
        {/* Toggle Button Glass */}
        <div className="flex p-1 rounded-xl bg-black/20 border border-white/10 backdrop-blur-md">
          <button className="px-6 py-2 bg-white/20 text-white rounded-lg shadow-sm font-semibold text-sm border border-white/20 transition-all">
            Chamber 1
          </button>
          <button className="px-6 py-2 text-white/60 font-semibold text-sm hover:text-white transition-colors">
            Chamber 2
          </button>
        </div>
        
        {/* Indikator */}
        <div className="text-white/80 font-mono text-lg tracking-widest font-bold">
          P1 / P2 / P3
        </div>
        
      </header>

      {/* Main Area Placeholder */}
      <main className="relative z-10 flex-1 p-8 flex flex-col gap-6">
        {/* Grid kartu akan kita buat di tahap selanjutnya */}
      </main>

    </div>
  );
}
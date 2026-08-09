import React from 'react';

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#1e3a8a] to-indigo-950 flex flex-col font-sans relative overflow-hidden">
      
      {/* Elemen Cahaya Dekoratif di Background (Orb) */}
      <div className="absolute top-0 left-20 w-96 h-96 bg-blue-500 rounded-full mix-blend-screen filter blur-[120px] opacity-40 animate-pulse"></div>
      <div className="absolute bottom-10 right-20 w-96 h-96 bg-cyan-400 rounded-full mix-blend-screen filter blur-[120px] opacity-20"></div>

      {/* 1. Header / Navbar (Efek Kaca) */}
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

      {/* 2. Main Area (Grid Kartu Kaca) */}
      <main className="relative z-10 flex-1 p-8 mx-[-8px] flex flex-col gap-6">
        
        {/* Baris Atas: Grid 3 Kolom */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-[400px]">
          
          {/* Kolom Kiri: Suhu & Kelembapan */}
          <div className="flex flex-col gap-6 h-full">
            {/* Kartu Suhu Glassmorphism */}
            <div className="flex-1 bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl text-white p-6 flex flex-col shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]">
              <p className="text-[10px] font-bold font-mono tracking-wide uppercase leading-tight text-white/70">
                Chamber 1<br/>Ruangan X
              </p>
              <div className="flex-1 flex items-center justify-center">
                <span className="text-5xl font-black font-mono drop-shadow-lg">25 ^C</span>
              </div>
            </div>
            
            {/* Kartu Kelembapan Glassmorphism */}
            <div className="flex-1 bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl p-6 flex flex-col justify-center relative shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]">
              <div className="flex items-center justify-center h-full">
                <span className="text-5xl font-black text-white font-mono drop-shadow-lg">55 %</span>
              </div>
              <p className="text-white/70 text-xs font-bold font-mono absolute bottom-4 right-4">
                Humidity
              </p>
            </div>
          </div>

          {/* Kolom Tengah: Grafik GAS */}
          <div className="md:col-span-2 bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl flex flex-col items-center justify-center shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-6 group hover:bg-white/15 transition-all duration-300">
            <h2 className="text-4xl font-black text-white/90 text-center uppercase tracking-wider drop-shadow-md">
              Grafik<br/>GAS
            </h2>
          </div>

          {/* Kolom Kanan: Export CSV */}
          <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-6 flex flex-col items-center justify-center gap-8 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/20 cursor-pointer transition-all duration-300 group">
            <h2 className="text-3xl font-black text-white/90 text-center uppercase tracking-wider leading-tight drop-shadow-md">
              Ringkasan<br/>Tabel CSV
            </h2>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white/80 group-hover:scale-110 group-hover:text-white transition-all duration-300 drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
          </div>
        </div>

        {/* Baris Bawah: Daftar Sensor */}
        <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-8 flex justify-between items-center shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] mt-4">
          <span className="font-black text-sm font-mono text-white/80 tracking-widest drop-shadow-sm">MQ-137</span>
          <span className="font-black text-sm font-mono text-white/80 tracking-widest drop-shadow-sm">MQ-136</span>
          <span className="font-black text-sm font-mono text-white/80 tracking-widest drop-shadow-sm">MQ-4</span>
          <span className="font-black text-sm font-mono text-white/80 tracking-widest drop-shadow-sm">DHT-22</span>
        </div>
        
      </main>

      {/* 3. Footer */}
      <footer className="relative z-10 py-6 text-center text-xs font-mono font-bold text-white/50 tracking-widest">
        *E-Sniffer team 2026
      </footer>
      
    </div>
  );
}
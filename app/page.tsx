"use client"; // Wajib ditambahkan karena Recharts butuh sisi client (browser)

import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Data dummy simulasi pergerakan sensor gas
const dummyData = [
  { time: '10:00', mq137: 240, mq136: 120, mq4: 300 },
  { time: '10:05', mq137: 255, mq136: 125, mq4: 310 },
  { time: '10:10', mq137: 270, mq136: 130, mq4: 305 },
  { time: '10:15', mq137: 260, mq136: 140, mq4: 320 },
  { time: '10:20', mq137: 280, mq136: 145, mq4: 340 },
  { time: '10:25', mq137: 310, mq136: 160, mq4: 360 },
  { time: '10:30', mq137: 340, mq136: 180, mq4: 390 }, // Simulasi gas mulai naik
];

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#1e3a8a] to-indigo-950 flex flex-col font-sans relative overflow-hidden">
      
      {/* Elemen Cahaya Dekoratif di Background (Orb) */}
      <div className="absolute top-0 left-20 w-96 h-96 bg-blue-500 rounded-full mix-blend-screen filter blur-[120px] opacity-40 animate-pulse pointer-events-none"></div>
      <div className="absolute bottom-10 right-20 w-96 h-96 bg-cyan-400 rounded-full mix-blend-screen filter blur-[120px] opacity-20 pointer-events-none"></div>

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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 min-h-[550px]">
          
          {/* Kolom Kiri: Suhu & Kelembapan */}
          <div className="flex flex-col gap-6 h-full">
            <div className="flex-1 bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl text-white p-6 flex flex-col shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]">
              <p className="text-[10px] font-bold font-mono tracking-wide uppercase leading-tight text-white/70">
                Chamber 1<br/>Ruangan X
              </p>
              <div className="flex-1 flex items-center justify-center">
                <span className="text-5xl font-black font-mono drop-shadow-lg">25 ^C</span>
              </div>
            </div>
            
            <div className="flex-1 bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl p-6 flex flex-col justify-center relative shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]">
              <div className="flex items-center justify-center h-full">
                <span className="text-5xl font-black text-white font-mono drop-shadow-lg">55 %</span>
              </div>
              <p className="text-white/70 text-xs font-bold font-mono absolute bottom-4 right-4">
                Humidity
              </p>
            </div>
          </div>

          {/* Kolom Tengah: Grafik GAS (Recharts) */}
          <div className="md:col-span-2 bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl flex flex-col shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-black text-white/90 uppercase tracking-wider drop-shadow-md">
                Pergerakan Gas Aktif
              </h2>
              <span className="flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
              </span>
            </div>
            
            {/* Area Rendering Grafik */}
            <div className="flex-1 w-full min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dummyData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" vertical={false} />
                  <XAxis dataKey="time" stroke="#ffffff70" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#ffffff70" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '12px' }}
                    itemStyle={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}
                  />
                  <Line type="monotone" dataKey="mq137" stroke="#38bdf8" strokeWidth={3} dot={{ r: 4, fill: '#38bdf8', strokeWidth: 0 }} activeDot={{ r: 6 }} name="MQ-137" />
                  <Line type="monotone" dataKey="mq4" stroke="#a78bfa" strokeWidth={3} dot={{ r: 4, fill: '#a78bfa', strokeWidth: 0 }} activeDot={{ r: 6 }} name="MQ-4" />
                </LineChart>
              </ResponsiveContainer>
            </div>
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

        {/* Baris Bawah: Daftar Sensor + Gambar & Senyawa Target */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
          
          {/* Card MQ-137 */}
          <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-4 flex flex-col items-center text-center shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/15 transition-all">
            <div className="w-25 h-25 relative rounded-xl overflow-hidden mb-3 border border-white/20 bg-black/20 p-1">
              <img src="/mq137.png" alt="MQ-137 Sensor" className="w-full h-full object-cover rounded-lg" />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8]"></span>
              <span className="font-black text-sm font-mono text-white tracking-wider">MQ-137</span>
            </div>
            <span className="text-[11px] font-mono text-cyan-300 font-semibold uppercase tracking-wide">Amonia (NH₃)</span>
          </div>

          {/* Card MQ-136 */}
          <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-4 flex flex-col items-center text-center shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/15 transition-all">
            <div className="w-25 h-25 relative rounded-xl overflow-hidden mb-3 border border-white/20 bg-black/20 p-1">
              <img src="/mq136.png" alt="MQ-136 Sensor" className="w-full h-full object-cover rounded-lg" />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-white/40"></span>
              <span className="font-black text-sm font-mono text-white tracking-wider">MQ-136</span>
            </div>
            <span className="text-[11px] font-mono text-purple-300 font-semibold uppercase tracking-wide">Hidrogen Sulfida (H₂S)</span>
          </div>

          {/* Card MQ-4 */}
          <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-4 flex flex-col items-center text-center shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/15 transition-all">
            <div className="w-25 h-25 relative rounded-xl overflow-hidden mb-3 border border-white/20 bg-black/20 p-1">
              <img src="/mq4.png" alt="MQ-4 Sensor" className="w-full h-full object-cover rounded-lg" />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#a78bfa]"></span>
              <span className="font-black text-sm font-mono text-white tracking-wider">MQ-4</span>
            </div>
            <span className="text-[11px] font-mono text-emerald-300 font-semibold uppercase tracking-wide">Metana (CH₄) / CNG</span>
          </div>

          {/* Card DHT-22 */}
          <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-4 flex flex-col items-center text-center shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/15 transition-all">
            <div className="w-25 h-25 relative rounded-xl overflow-hidden mb-3 border border-white/20 bg-black/20 p-1">
              <img src="/dht22.png" alt="DHT-22 Sensor" className="w-full h-full object-cover rounded-lg" />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-white/40"></span>
              <span className="font-black text-sm font-mono text-white tracking-wider">DHT-22</span>
            </div>
            <span className="text-[11px] font-mono text-amber-300 font-semibold uppercase tracking-wide">Suhu & Kelembapan</span>
          </div>

        </div>
        
      </main> 

      {/* 3. Footer */}
      <footer className="relative z-10 py-6 text-center text-xs font-mono font-bold text-white/50 tracking-widest">
        *E-Sniffer n Team 2026
      </footer>
      
    </div>
  );
}


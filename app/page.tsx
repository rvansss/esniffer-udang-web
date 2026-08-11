import React from 'react';
import Header from '../components/Header';
import MetricCard from '../components/MetricCard';
import ChartPanel from '../components/ChartPanel';
import ExportPanel from '../components/ExportPanel';
import SensorCard from '../components/SensorCard';

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#1e3a8a] to-indigo-950 flex flex-col font-sans relative overflow-hidden">
      
      {/* Background Orbs */}
      <div className="absolute top-0 left-20 w-96 h-96 bg-blue-500 rounded-full mix-blend-screen filter blur-[120px] opacity-40 animate-pulse pointer-events-none"></div>
      <div className="absolute bottom-10 right-20 w-96 h-96 bg-cyan-400 rounded-full mix-blend-screen filter blur-[120px] opacity-20 pointer-events-none"></div>

      <Header />

      <main className="relative z-10 flex-1 p-8 mx-[-8px] flex flex-col gap-6">
        
        {/* Grid Atas */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 min-h-[550px]">
          <div className="flex flex-col gap-6 h-full">
            <MetricCard 
              title={<>Chamber 1<br/>Ruangan X</>} 
              value="25 ^C" 
              isPrimary={true} 
            />
            <MetricCard 
              title="Humidity" 
              value="55 %" 
              subtitle="Humidity" 
            />
          </div>

          <ChartPanel />
          <ExportPanel />
        </div>

        {/* Baris Daftar Sensor */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
          <SensorCard imageSrc="/mq137.png" name="MQ-137" compound="Amonia (NH₃)" dotColorClass="bg-[#38bdf8]" compoundColorClass="text-cyan-300" />
          <SensorCard imageSrc="/mq136.png" name="MQ-136" compound="Hidrogen Sulfida (H₂S)" dotColorClass="bg-white/40" compoundColorClass="text-purple-300" />
          <SensorCard imageSrc="/mq4.png" name="MQ-4" compound="Metana (CH₄) / CNG" dotColorClass="bg-[#a78bfa]" compoundColorClass="text-emerald-300" />
          <SensorCard imageSrc="/dht22.png" name="DHT-22" compound="Suhu & Kelembapan" dotColorClass="bg-white/40" compoundColorClass="text-amber-300" />
        </div>
        
      </main> 

      <footer className="relative z-10 py-6 text-center text-xs font-mono font-bold text-white/50 tracking-widest">
        *E-Sniffer n Team 2026
      </footer>
      
    </div>
  );
}
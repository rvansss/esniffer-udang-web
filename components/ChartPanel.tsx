"use client";

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function ChartPanel() {
  // State untuk menyimpan data grafik
  const [chartData, setChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fungsi untuk menarik data dari API Route kita
  const fetchSensorData = async () => {
    try {
      const response = await fetch('/api/sensor');
      const result = await response.json();
      setChartData(result.data);
    } catch (error) {
      console.error("Gagal menarik data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Gunakan useEffect untuk menarik data saat komponen pertama kali dimuat
  useEffect(() => {
    fetchSensorData();
    
    // Opsional: Buat interval untuk menarik data baru setiap 5 detik
    const interval = setInterval(() => {
      fetchSensorData();
    }, 5000);

    return () => clearInterval(interval); // Bersihkan interval saat pindah halaman
  }, []);

  return (
    <div className="md:col-span-2 bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl flex flex-col shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-black text-white/90 uppercase tracking-wider drop-shadow-md">
          Pergerakan Gas Aktif
        </h2>
        
        {/* Indikator Status Data */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest">
            {isLoading ? 'Memuat...' : 'Live'}
          </span>
          <span className="flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
          </span>
        </div>
      </div>
      
      <div className="flex-1 w-full min-h-[200px]">
        {isLoading && chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/50 font-mono text-sm">
            Menghubungkan ke Prometheus...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
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
        )}
      </div>
    </div>
  );
}
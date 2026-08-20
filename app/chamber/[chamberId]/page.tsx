"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation'; // <-- Import penangkap URL
import MetricCard from '../../../components/ui/MetricCard'; // Path import bertambah
import ChartPanel from '../../../components/charts/ChartPanel';
import ExportPanel from '../../../components/layout/ExportPanel';
import SensorCard from '../../../components/ui/SensorCard';

export default function Dashboard() {
  const params = useParams();
  const chamberId = params.chamberId as string; // Menangkap angka 1, 2, dll dari URL

  const [sensorData, setSensorData] = useState({
    temp: "0.0",
    humidity: "0.0",
    mq137: "0.00",
    mq136: "0.00",
    mq4: "0.00"
  });

  useEffect(() => {
    if (!chamberId) return; // Cegah error jika ID belum terbaca

    const fetchData = async () => {
      try {
        // Menembak API dinamis sesuai ruangan yang sedang dibuka
        const res = await fetch(`/api/sensor/${chamberId}`);
        const data = await res.json();
        setSensorData(data);
      } catch (error) {
        console.error("Gagal mengambil metrik:", error);
      }
    };

    fetchData(); 
    const intervalId = setInterval(fetchData, 5000); 

    return () => clearInterval(intervalId); 
  }, [chamberId]); // Beri tahu React untuk memantau perubahan chamberId

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 min-h-[550px]">
        <div className="flex flex-col gap-6 h-full">
          {/* Judul Chamber sekarang berubah otomatis */}
          <MetricCard 
            title={<>Chamber {chamberId}<br/>Ruangan {chamberId === '1' ? 'X' : 'Y'}</>} 
            value={`${sensorData.temp} ^C`} 
            isPrimary={true} 
          />
          <MetricCard title="Humidity" value={`${sensorData.humidity} %`} subtitle="Humidity" />
        </div>

        {/* Kirim ID ruangan ke komponen Grafik agar grafiknya tidak salah ambil data */}
        <ChartPanel chamberId={chamberId} /> 
        <ExportPanel />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
        <SensorCard imageSrc="/mq137.png" name="MQ-137" compound={`Amonia: ${sensorData.mq137} Raw`} dotColorClass="bg-[#38bdf8]" compoundColorClass="text-cyan-300" />
        <SensorCard imageSrc="/mq136.png" name="MQ-136" compound={`H₂S: ${sensorData.mq136} Raw`} dotColorClass="bg-white/40" compoundColorClass="text-purple-300" />
        <SensorCard imageSrc="/mq4.png" name="MQ-4" compound={`Metana: ${sensorData.mq4} Raw`} dotColorClass="bg-[#a78bfa]" compoundColorClass="text-emerald-300" />
        <SensorCard imageSrc="/dht22.png" name="DHT-22" compound={`Suhu: ${sensorData.temp}°C | Kel: ${sensorData.humidity}%`} dotColorClass="bg-white/40" compoundColorClass="text-amber-300" />
      </div>
    </div>
  );
}
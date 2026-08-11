import { NextResponse } from 'next/server';

// Data dummy (sebagai fallback jika Prometheus belum menyala)
const fallbackData = [
  { time: '10:00', mq137: 240, mq136: 120, mq4: 300 },
  { time: '10:05', mq137: 255, mq136: 125, mq4: 310 },
  { time: '10:10', mq137: 270, mq136: 130, mq4: 305 },
  { time: '10:15', mq137: 260, mq136: 140, mq4: 320 },
  { time: '10:20', mq137: 280, mq136: 145, mq4: 340 },
  { time: '10:25', mq137: 310, mq136: 160, mq4: 360 },
  { time: '10:30', mq137: 340, mq136: 180, mq4: 390 },
];

export async function GET() {
  try {
    // URL Prometheus (asumsi berjalan di localhost:9090)
    // Di sini nantinya kita memanggil API Prometheus: /api/v1/query_range
    const prometheusUrl = 'http://localhost:9090/api/v1/query?query=up'; 
    
    // Mencoba melakukan fetch ke Prometheus
    const res = await fetch(prometheusUrl, { cache: 'no-store' });
    
    if (!res.ok) {
      throw new Error("Gagal mengambil data dari Prometheus");
    }

    const prometheusData = await res.json();

    // TODO: Transformasi data Prometheus (JSON) menjadi format Recharts di sini.
    // Karena saat ini Node-RED & Prometheus mungkin belum memompa data asli,
    // kita asumsikan fetch berhasil, namun kita tetap me-return struktur yang siap dibaca Recharts.

    return NextResponse.json({
      status: "success",
      source: "prometheus", 
      data: fallbackData // Nanti ini diganti dengan hasil parse prometheusData
    });

  } catch (error) {
    // Pintar: Jika Prometheus belum jalan (error fetch), jangan buat webnya hancur (crash).
    // Kembalikan data dummy agar UI tetap cantik selama masa development.
    return NextResponse.json({
      status: "fallback",
      source: "dummy",
      data: fallbackData
    });
  }
}
// app/api/sensor/[chamberId]/route.ts

import { NextResponse } from 'next/server';
// Perhatikan jalur importnya bertambah satu '../' karena foldernya lebih dalam
import { fetchPrometheus } from '../../../../lib/prometheus'; 

export async function GET(
  request: Request,
  { params }: { params: { chamberId: string } }
) {
  // Menangkap angka dari URL (misal: "1" dari /api/sensor/1)
  const chamberId = params.chamberId; 
  
  // Membuat filter label Prometheus (contoh hasil: {ruangan="chamber1"})
  const label = `{ruangan="chamber${chamberId}"}`;

  // Menembak data ke database dengan filter ruangan yang spesifik
  const [temp, humidity, mq137, mq136, mq4] = await Promise.all([
    fetchPrometheus(`esniffer_temp_c${label}`),
    fetchPrometheus(`esniffer_humidity_percent${label}`),
    fetchPrometheus(`esniffer_mq137_raw${label}`), 
    fetchPrometheus(`esniffer_mq136_raw${label}`), 
    fetchPrometheus(`esniffer_mq4_raw${label}`),   
  ]);

  return NextResponse.json({
    temp: temp.toFixed(1),
    humidity: humidity.toFixed(1),
    mq137: mq137.toFixed(2),
    mq136: mq136.toFixed(2),
    mq4: mq4.toFixed(2),
  });
}
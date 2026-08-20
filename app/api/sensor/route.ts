// app/api/sensor/route.ts

import { NextResponse } from 'next/server';
import { fetchPrometheus } from '../../../lib/prometheus'; // Memanggil fungsi dari folder lib

export async function GET() {
  const [temp, humidity, mq137, mq136, mq4] = await Promise.all([
    fetchPrometheus('esniffer_temp_c'),
    fetchPrometheus('esniffer_humidity_percent'),
    fetchPrometheus('esniffer_mq137_raw'), 
    fetchPrometheus('esniffer_mq136_raw'), 
    fetchPrometheus('esniffer_mq4_raw'),   
  ]);

  return NextResponse.json({
    temp: temp.toFixed(1),
    humidity: humidity.toFixed(1),
    mq137: mq137.toFixed(2),
    mq136: mq136.toFixed(2),
    mq4: mq4.toFixed(2),
  });
}
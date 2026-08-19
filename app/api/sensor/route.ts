import { NextResponse } from 'next/server';

// Fungsi bantuan untuk menembak API Prometheus
async function fetchPrometheus(metricName: string) {
  try {
    // Memanggil endpoint bawaan Prometheus
    const res = await fetch(`http://localhost:9090/api/v1/query?query=${metricName}`, {
      cache: 'no-store', // Pastikan selalu mengambil data terbaru, bukan cache
    });
    const json = await res.json();
    
    // Mengecek apakah datanya ada
    if (json.status === 'success' && json.data.result.length > 0) {
      // Prometheus mengirim angka dalam format teks, jadi kita ubah ke Float (Desimal)
      return parseFloat(json.data.result[0].value[1]);
    }
    return 0; // Kembalikan 0 jika belum ada data masuk
  } catch (error) {
    console.error(`Gagal mengambil metrik ${metricName}:`, error);
    return 0;
  }
}

export async function GET() {
  // Menarik semua data sensor secara paralel agar lebih cepat
  const [temp, humidity, mq137, mq136, mq4] = await Promise.all([
    fetchPrometheus('esniffer_temp_c'),
    fetchPrometheus('esniffer_humidity_percent'),
    fetchPrometheus('esniffer_mq137_raw'), 
  fetchPrometheus('esniffer_mq136_raw'), 
  fetchPrometheus('esniffer_mq4_raw')
  ]);

  // Mengembalikan datanya dalam format JSON yang rapi ke Frontend
  return NextResponse.json({
    temp: temp.toFixed(1),
    humidity: humidity.toFixed(1),
    mq137: mq137.toFixed(2),
    mq136: mq136.toFixed(2),
    mq4: mq4.toFixed(2),
  });
}
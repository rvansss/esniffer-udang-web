// lib/prometheus.ts

export async function fetchPrometheus(metricName: string) {
  try {
    // Mengambil URL dari file .env.local, jika tidak ada, default ke localhost
    const baseUrl = process.env.NEXT_PUBLIC_PROMETHEUS_URL || 'http://localhost:9090';

    const res = await fetch(`${baseUrl}/api/v1/query?query=${metricName}`, {
      cache: 'no-store', 
    });
    const json = await res.json();
    
    if (json.status === 'success' && json.data.result.length > 0) {
      return parseFloat(json.data.result[0].value[1]);
    }
    return 0; 
  } catch (error) {
    console.error(`Gagal mengambil metrik ${metricName}:`, error);
    return 0;
  }
}
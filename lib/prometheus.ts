// lib/prometheus.ts

export async function fetchPrometheus(metricName: string) {
  try {
    const res = await fetch(`http://localhost:9090/api/v1/query?query=${metricName}`, {
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
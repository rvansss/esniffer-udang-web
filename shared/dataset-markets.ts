/**
 * Daftar baku sumber pasar untuk kolom `market_source` (PRD §3.1 Tahap A).
 *
 * SEMENTARA — HARUS diganti dengan daftar baku 5 pasar sekitar kampus
 * (Appendix B PRD / blocker #1 implementation plan) sebelum rilis.
 * Bentuknya (readonly array + tipe union) sudah final, sehingga saat
 * daftar diganti cukup edit array ini — API, UI, dan test yang
 * mengimpornya tidak perlu diubah.
 */
export const MARKET_SOURCES = [
  "Pasar Contoh 1",
  "Pasar Contoh 2",
  "Pasar Contoh 3",
  "Pasar Contoh 4",
  "Pasar Contoh 5",
] as const;

export type MarketSource = (typeof MARKET_SOURCES)[number];

export function isMarketSource(value: unknown): value is MarketSource {
  return (
    typeof value === "string" &&
    (MARKET_SOURCES as readonly string[]).includes(value)
  );
}

export const SHRIMP_TYPES = [
  { value: 'vaname', label: 'Vaname' },
  { value: 'windu', label: 'Windu' },
] as const;

export type ShrimpTypeCode = (typeof SHRIMP_TYPES)[number]['value'];

export function isShrimpType(value: unknown): value is ShrimpTypeCode {
  return SHRIMP_TYPES.some((type) => type.value === value);
}

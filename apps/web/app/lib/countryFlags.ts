// apps/web/lib/countryFlags.ts
// Convert ISO 3166-1 alpha-2 country codes to flag emojis
// Works by converting letters to regional indicator symbols

export function countryToFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return '🌐';

  try {
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  } catch {
    return '🌐';
  }
}

// Country code to name mapping for tooltip
export const COUNTRY_NAMES: Record<string, string> = {
  CA: 'Canada', US: 'United States', GB: 'United Kingdom',
  AU: 'Australia', NG: 'Nigeria', RU: 'Russia', DE: 'Germany',
  FR: 'France', JP: 'Japan', CN: 'China', BR: 'Brazil',
  IN: 'India', MX: 'Mexico', KP: 'North Korea', IR: 'Iran',
  VE: 'Venezuela', BY: 'Belarus', PH: 'Philippines', RO: 'Romania',
  UA: 'Ukraine',
};
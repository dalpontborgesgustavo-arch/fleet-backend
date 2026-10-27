export const PRODUCTION_SERVICES = [
  { activity: 'Terraplanagem', unit: 'm³', suggestedPrice: '14' },
  { activity: 'Macadame', unit: 't', suggestedPrice: '86.0405809956758' },
  { activity: 'Asfalto', unit: 't', suggestedPrice: '565', priceVaries: true },
  { activity: 'Drenagem', unit: 'm', suggestedPrice: '200' },
  { activity: 'Base', unit: 't', suggestedPrice: '108.44444444444444' },
  { activity: 'Sarjetas', unit: 'm', suggestedPrice: '60' },
  { activity: 'Microfresagem', unit: 'm²', suggestedPrice: '15.15' },
  { activity: 'Microrevestimento', unit: 'm²', suggestedPrice: '20.37' },
] as const;

export function normalizedName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('pt-BR')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function uniqueCanonicalName(
  value: string,
  candidates: readonly string[],
): string | null {
  const searched = normalizedName(value);
  if (!searched) return null;
  const matches = [...new Set(candidates)].filter((candidate) => {
    const canonical = normalizedName(candidate);
    return canonical === searched || canonical.startsWith(`${searched} `);
  });
  return matches.length === 1 ? matches[0] : null;
}

// Some Aethos work descriptions begin with a locality, but it is not a
// structured city field. Only the conventional city/SC or city - CC prefix
// is safe enough to prefill; all other cases remain explicit review.
export function municipalityFromWorkName(name: string): string | null {
  const match = name.match(
    /^(.{3,45}?)\s*(?:\/SC)?\s+-\s+(?:CC|TP|PE|CE|CP)\b/i,
  );
  return match ? match[1].trim() : null;
}

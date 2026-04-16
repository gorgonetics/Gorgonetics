export function getSpeciesEmoji(species: string | undefined | null): string {
  const s = (species || '').toLowerCase();
  if (s.includes('bee') || s.includes('wasp')) return '🐝';
  if (s.includes('horse')) return '🐴';
  return '🐾';
}

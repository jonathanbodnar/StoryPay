/** Capitalizes the first letter of each word in a name string. */
export function capitalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

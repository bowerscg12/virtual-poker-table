/** Format a chip count as an exact integer with locale-appropriate thousands separators. */
export function formatChips(amount: number): string {
  return Math.round(amount).toLocaleString();
}

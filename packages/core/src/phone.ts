/**
 * Sri Lankan phone normalization to E.164 (+94XXXXXXXXX).
 * Accepts: 0771234567, 771234567, +94771234567, 94771234567, 0094771234567,
 * "+94 77 123 4567" and similar. Returns null for numbers that cannot be
 * interpreted as a valid Sri Lankan mobile/landline.
 */
export function normalizeLKPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("94")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^\d{9}$/.test(digits)) return null;
  // First digit after country code must be 1-9 area/operator code
  return `+94${digits}`;
}

export function isValidLKPhone(input: string | null | undefined): boolean {
  return normalizeLKPhone(input) !== null;
}

/** Display format: +94 77 123 4567 */
export function formatLKPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace("+94", "");
  if (d.length !== 9) return e164;
  return `+94 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
}

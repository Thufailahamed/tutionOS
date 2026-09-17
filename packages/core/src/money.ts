/**
 * Money is always stored as integer minor units (cents) with a currency code.
 * Never use floating point for monetary values.
 */
export const DEFAULT_CURRENCY = "LKR";

export type MoneyCents = number;

export function centsToDisplay(cents: number, currency: string = DEFAULT_CURRENCY): string {
  const major = cents / 100;
  const formatted = major.toLocaleString("en-LK", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency === "LKR" ? `Rs. ${formatted}` : `${currency} ${formatted}`;
}

export function displayToCents(input: string | number): number {
  if (typeof input === "number") return Math.round(input * 100);
  const m = input.replace(/,/g, "").match(/\d+(\.\d+)?/);
  if (!m) return 0;
  return Math.round(parseFloat(m[0]) * 100);
}

export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `Rs. ${(cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-LK", { year: "numeric", month: "short", day: "numeric" });
}

export function datetime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-LK", { dateStyle: "medium", timeStyle: "short" });
}

export function pct(bps: number | null | undefined): string {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

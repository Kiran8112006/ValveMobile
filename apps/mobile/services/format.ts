/** Display helpers. Water is always stored as integer millilitres. */

export function litres(ml: number | null | undefined): string {
  const value = typeof ml === 'number' && Number.isFinite(ml) ? ml : 0;
  return (value / 1000).toFixed(2);
}

export function millilitres(ml: number | null | undefined): string {
  const value = typeof ml === 'number' && Number.isFinite(ml) ? ml : 0;
  return `${Math.round(value)} mL`;
}

export function inr(paise: number | null | undefined): string {
  const value = typeof paise === 'number' && Number.isFinite(paise) ? paise : 0;
  return `₹${(value / 100).toFixed(2)}`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'never';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function signedLitres(deltaMl: number): string {
  const sign = deltaMl > 0 ? '+' : deltaMl < 0 ? '−' : '';
  return `${sign}${litres(Math.abs(deltaMl))} L`;
}

export function formatMl(ml: number | null | undefined): string {
  const value = typeof ml === 'number' && Number.isFinite(ml) ? ml : 0;
  return `${Math.round(value)}`;
}

export function rupeesToPaise(input: string): number | null {
  const normalized = input.replace(/[₹,\s]/g, '');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export const microToAlgo = (micro: number) => micro / 1_000_000;
export const fmtAlgo = (micro: number, digits = 2) =>
  microToAlgo(micro).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const fmtBpsPct = (bps: number) => (bps / 100).toFixed(2) + '%';
export const truncAddr = (addr: string, n = 6) =>
  !addr ? '' : `${addr.slice(0, n)}…${addr.slice(-4)}`;
export const relTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
export const interestAlgo = (amountAlgo: number, bps: number, tenureDays: number) =>
  amountAlgo * (bps / 10000) * tenureDays / 365;

export const scoreTier = (score: number) => {
  if (score >= 850) return { label: 'Excellent', color: 'hsl(var(--success))' };
  if (score >= 600) return { label: 'Good',      color: 'hsl(var(--info))' };
  if (score >= 300) return { label: 'Fair',      color: 'hsl(var(--warning))' };
  return                  { label: 'Poor',      color: 'hsl(var(--destructive))' };
};

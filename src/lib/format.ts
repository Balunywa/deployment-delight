export const currency = (value: number | null | undefined, opts?: { compact?: boolean }) => {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: opts?.compact ? "compact" : "standard",
  }).format(value);
};

export const number = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : new Intl.NumberFormat("en-US").format(value);

export const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${Math.round(Number(value))}%`;

export const dateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const shortDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

export const relative = (value: string | null | undefined) => {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(value);
};

export const titleize = (value: string | null | undefined) =>
  (value ?? "").replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const ROON_DISPLAY_LINK = /\[\[[^|\]]+\|([^\]]+)\]\]/g;

export function hasRoonDisplayLink(value: unknown): boolean {
  return typeof value === "string" && /\[\[[^|\]]+\|[^\]]+\]\]/.test(value);
}

export function cleanRoonDisplayText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(ROON_DISPLAY_LINK, "$1")
    .trim();
  return cleaned || null;
}

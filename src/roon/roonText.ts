const ROON_DISPLAY_LINK = /\[\[[^|\]]+\|([^\]]+)\]\]/g;

export type RoonDisplayLink = {
  id: string;
  name: string;
};

export function hasRoonDisplayLink(value: unknown): boolean {
  return typeof value === "string" && /\[\[[^|\]]+\|[^\]]+\]\]/.test(value);
}

export function extractRoonDisplayLinks(value: unknown): RoonDisplayLink[] {
  if (typeof value !== "string") return [];
  return Array.from(value.matchAll(/\[\[([^|\]]+)\|([^\]]+)\]\]/g), (match) => ({
    id: match[1].trim(),
    name: match[2].trim()
  })).filter((link) => link.id && link.name);
}

export function cleanRoonDisplayText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(ROON_DISPLAY_LINK, "$1")
    .trim();
  return cleaned || null;
}

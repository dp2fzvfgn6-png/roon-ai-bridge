import crypto from "crypto";
import { AppConfig } from "../config/env";

export type WidgetAssetKind = "roon-image" | "playlist-cover";

const SIGNATURE_TTL_SECONDS = 2 * 60 * 60;
const SIGNATURE_BUCKET_SECONDS = 15 * 60;
const MAX_FUTURE_SECONDS = SIGNATURE_TTL_SECONDS + SIGNATURE_BUCKET_SECONDS;

function assetPath(kind: WidgetAssetKind, assetId: string): string {
  const segment = kind === "roon-image" ? "roon-images" : "playlist-covers";
  return `/widget-assets/${segment}/${encodeURIComponent(assetId)}`;
}

function legacyPath(kind: WidgetAssetKind, assetId: string): string {
  return kind === "roon-image"
    ? `/roon/images/${encodeURIComponent(assetId)}`
    : `/playlists/covers/${encodeURIComponent(assetId)}`;
}

function signaturePayload(kind: WidgetAssetKind, assetId: string, expires: number): string {
  return `${kind}\n${assetId}\n${expires}`;
}

function sign(secret: string, kind: WidgetAssetKind, assetId: string, expires: number): string {
  return crypto
    .createHmac("sha256", secret)
    .update(signaturePayload(kind, assetId, expires))
    .digest("base64url");
}

export function createWidgetAssetUrl(
  config: Pick<AppConfig, "enableAuth" | "apiToken" | "publicBaseUrl">,
  kind: WidgetAssetKind,
  assetId: string,
  now = Date.now()
): string {
  const baseUrl = config.publicBaseUrl?.replace(/\/+$/, "") || "";
  if (!config.enableAuth || !config.apiToken) {
    return `${baseUrl}${legacyPath(kind, assetId)}`;
  }

  const nowSeconds = Math.floor(now / 1000);
  const expires =
    Math.floor(nowSeconds / SIGNATURE_BUCKET_SECONDS) * SIGNATURE_BUCKET_SECONDS +
    SIGNATURE_TTL_SECONDS +
    SIGNATURE_BUCKET_SECONDS;
  const signature = sign(config.apiToken, kind, assetId, expires);
  return `${baseUrl}${assetPath(kind, assetId)}?expires=${expires}&signature=${encodeURIComponent(signature)}`;
}

export function verifyWidgetAssetSignature(
  config: Pick<AppConfig, "enableAuth" | "apiToken">,
  kind: WidgetAssetKind,
  assetId: string,
  expiresValue: unknown,
  signatureValue: unknown,
  now = Date.now()
): boolean {
  if (!config.enableAuth) return true;
  if (!config.apiToken || typeof signatureValue !== "string") return false;

  const expires = Number.parseInt(String(expiresValue || ""), 10);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isInteger(expires) ||
    expires < nowSeconds ||
    expires > nowSeconds + MAX_FUTURE_SECONDS
  ) return false;

  const expected = Buffer.from(sign(config.apiToken, kind, assetId, expires));
  const provided = Buffer.from(signatureValue);
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

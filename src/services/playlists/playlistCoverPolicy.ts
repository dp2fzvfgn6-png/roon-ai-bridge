import path from "path";
import sharp from "sharp";
import { ApiError } from "../../utils/errors";

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export const CUSTOM_COVER_PREFIX = "custom:";
export const MAX_CUSTOM_COVER_BYTES = 5 * 1024 * 1024;
export const MAX_CUSTOM_COVER_INPUT_PIXELS = 40_000_000;
export const MIN_CUSTOM_COVER_DIMENSION = 768;
export const NORMALIZED_COVER_SIZE = 1024;
export const MAX_NORMALIZED_COVER_BYTES = 750 * 1024;
const COVER_CONTENT_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

export const PLAYLIST_COVER_POLICY = {
  recommended_width: 1024,
  recommended_height: 1024,
  minimum_width: MIN_CUSTOM_COVER_DIMENSION,
  minimum_height: MIN_CUSTOM_COVER_DIMENSION,
  maximum_input_bytes: MAX_CUSTOM_COVER_BYTES,
  maximum_input_pixels: MAX_CUSTOM_COVER_INPUT_PIXELS,
  maximum_stored_width: NORMALIZED_COVER_SIZE,
  maximum_stored_height: NORMALIZED_COVER_SIZE,
  maximum_stored_bytes: MAX_NORMALIZED_COVER_BYTES,
  accepted_content_types: Array.from(COVER_CONTENT_TYPES.keys()),
  preferred_content_type: "image/webp",
  color_space: "sRGB",
  crop: "center square",
  edge_safe: true
} as const;

export function customCoverFileName(imageKey: string | null): string | null {
  if (!imageKey?.startsWith(CUSTOM_COVER_PREFIX)) return null;
  const fileName = imageKey.slice(CUSTOM_COVER_PREFIX.length);
  return fileName && path.basename(fileName) === fileName ? fileName : null;
}
export function decodeCoverInput(input: {
  data_url?: unknown;
  image_base64?: unknown;
  content_type?: unknown;
}): { contentType: string; extension: string; bytes: Buffer } {
  let contentType = optionalString(input.content_type);
  let encoded = optionalString(input.image_base64);
  const dataUrl = optionalString(input.data_url);
  if (dataUrl) {
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) {
      throw new ApiError("INVALID_PLAYLIST_COVER", "data_url must contain a base64 JPEG, PNG or WebP image");
    }
    contentType = match[1].toLowerCase();
    encoded = match[2];
  }
  const extension = contentType ? COVER_CONTENT_TYPES.get(contentType) : null;
  if (!contentType || !extension || !encoded) {
    throw new ApiError("INVALID_PLAYLIST_COVER", "Image data and a supported content_type are required", {
      allowed_content_types: Array.from(COVER_CONTENT_TYPES.keys())
    });
  }
  const compact = encoded.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new ApiError("INVALID_PLAYLIST_COVER", "image_base64 is not valid base64 data");
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0 || bytes.length > MAX_CUSTOM_COVER_BYTES) {
    throw new ApiError("INVALID_PLAYLIST_COVER", "Playlist cover must be between 1 byte and 5 MB", {
      maximum_bytes: MAX_CUSTOM_COVER_BYTES,
      received_bytes: bytes.length
    });
  }
  const signatureMatches =
    (contentType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (contentType === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) ||
    (contentType === "image/webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP");
  if (!signatureMatches) {
    throw new ApiError("INVALID_PLAYLIST_COVER", "Image bytes do not match content_type");
  }
  return { contentType, extension, bytes };
}

export async function normalizeCoverImage(bytes: Buffer): Promise<Buffer> {
  try {
    const source = sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_CUSTOM_COVER_INPUT_PIXELS
    });
    const metadata = await source.metadata();
    const swapsAxes = typeof metadata.orientation === "number" && metadata.orientation >= 5;
    const sourceWidth = swapsAxes ? metadata.height : metadata.width;
    const sourceHeight = swapsAxes ? metadata.width : metadata.height;
    if (!sourceWidth || !sourceHeight) {
      throw new ApiError("INVALID_PLAYLIST_COVER", "Playlist cover dimensions could not be determined");
    }
    if (sourceWidth < MIN_CUSTOM_COVER_DIMENSION || sourceHeight < MIN_CUSTOM_COVER_DIMENSION) {
      throw new ApiError(
        "INVALID_PLAYLIST_COVER",
        `Playlist cover must be at least ${MIN_CUSTOM_COVER_DIMENSION}x${MIN_CUSTOM_COVER_DIMENSION} pixels`,
        {
          minimum_width: MIN_CUSTOM_COVER_DIMENSION,
          minimum_height: MIN_CUSTOM_COVER_DIMENSION,
          received_width: sourceWidth,
          received_height: sourceHeight
        }
      );
    }

    const image = source
      .rotate()
      .resize(NORMALIZED_COVER_SIZE, NORMALIZED_COVER_SIZE, {
        fit: "cover",
        position: "centre"
      });

    for (const quality of [88, 82, 76, 70, 60, 50]) {
      const normalized = await image.clone().webp({ quality, effort: 4 }).toBuffer();
      if (normalized.length <= MAX_NORMALIZED_COVER_BYTES) return normalized;
    }
    throw new Error("normalized image remains larger than 750 KB");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_PLAYLIST_COVER", "Playlist cover could not be decoded or normalized", {
      maximum_input_pixels: MAX_CUSTOM_COVER_INPUT_PIXELS,
      minimum_input_dimension: MIN_CUSTOM_COVER_DIMENSION,
      normalized_size_pixels: NORMALIZED_COVER_SIZE,
      maximum_normalized_bytes: MAX_NORMALIZED_COVER_BYTES,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

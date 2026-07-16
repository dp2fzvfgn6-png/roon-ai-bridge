import net from "node:net";
import { ApiError } from "../utils/errors";

export type ToolFileReference = {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
};

export type DownloadedToolImage = {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  fileId: string;
  fileName: string | null;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb");
}

function validatedDownloadUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("INVALID_PLAYLIST_COVER", "The authorized image download URL is invalid");
  }
  const hostname = url.hostname.toLowerCase();
  const ipVersion = net.isIP(hostname.replace(/^\[|\]$/g, ""));
  if (
    url.protocol !== "https:" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (ipVersion === 4 && isPrivateIpv4(hostname)) ||
    (ipVersion === 6 && isPrivateIpv6(hostname))
  ) {
    throw new ApiError(
      "INVALID_PLAYLIST_COVER",
      "The authorized image must use a public HTTPS download URL"
    );
  }
  return url;
}

function normalizedContentType(value: string | null | undefined): string | null {
  const type = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return IMAGE_CONTENT_TYPES.has(type) ? type : null;
}

export async function downloadToolImage(
  file: ToolFileReference,
  options: {
    maximumBytes: number;
    timeoutMs?: number;
    fetchImpl?: FetchLike;
  }
): Promise<DownloadedToolImage> {
  if (!file?.file_id || !file.download_url) {
    throw new ApiError(
      "INVALID_PLAYLIST_COVER",
      "The image file reference must include file_id and download_url"
    );
  }
  const url = validatedDownloadUrl(file.download_url);
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs || 15_000),
      headers: { accept: "image/jpeg,image/png,image/webp" }
    });
    if (!response.ok) {
      throw new ApiError("INVALID_PLAYLIST_COVER", "The authorized image could not be downloaded", {
        status: response.status,
        file_id: file.file_id
      });
    }
    if (response.url) validatedDownloadUrl(response.url);
    const declaredLength = Number.parseInt(response.headers.get("content-length") || "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > options.maximumBytes) {
      throw new ApiError("INVALID_PLAYLIST_COVER", "Playlist cover must be no larger than 5 MB", {
        maximum_bytes: options.maximumBytes,
        received_bytes: declaredLength
      });
    }
    const contentType = normalizedContentType(file.mime_type) ||
      normalizedContentType(response.headers.get("content-type"));
    if (!contentType) {
      throw new ApiError(
        "INVALID_PLAYLIST_COVER",
        "The authorized file must be a JPEG, PNG or WebP image",
        { mime_type: file.mime_type || response.headers.get("content-type") || null }
      );
    }

    const chunks: Buffer[] = [];
    let received = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > options.maximumBytes) {
          await reader.cancel();
          throw new ApiError("INVALID_PLAYLIST_COVER", "Playlist cover must be no larger than 5 MB", {
            maximum_bytes: options.maximumBytes,
            received_bytes: received
          });
        }
        chunks.push(Buffer.from(value));
      }
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length) {
      throw new ApiError("INVALID_PLAYLIST_COVER", "The authorized image file is empty");
    }
    return {
      bytes,
      contentType: contentType as DownloadedToolImage["contentType"],
      fileId: file.file_id,
      fileName: file.file_name?.trim() || null
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_PLAYLIST_COVER", "The authorized image could not be downloaded", {
      file_id: file.file_id,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

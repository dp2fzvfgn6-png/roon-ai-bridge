import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { roonSdkCall } from "./roonSdk";

export type RoonImageOptions = {
  scale?: "fit" | "fill" | "stretch";
  width?: number;
  height?: number;
  format?: "image/jpeg" | "image/png";
};

export async function getRoonImage(
  roonClient: RoonClient,
  imageKey: string,
  options: RoonImageOptions
): Promise<{ contentType: string; bytes: Buffer }> {
  if (!roonClient.isCoreConnected()) {
    throw new ApiError("ROON_NOT_CONNECTED", "Roon Core is not connected");
  }
  const image = roonClient.getImage();
  if (!roonClient.isImageReady() || !image) {
    throw new ApiError("IMAGE_NOT_READY", "Roon image service is not ready");
  }
  if (!imageKey.trim()) {
    throw new ApiError("INVALID_IMAGE_REQUEST", "image_key is required");
  }
  const width = Number(options.width ?? 500);
  const height = Number(options.height ?? 500);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 2000 ||
    height > 2000
  ) {
    throw new ApiError(
      "INVALID_IMAGE_REQUEST",
      "Image width and height must be between 1 and 2000"
    );
  }
  const scale = options.scale || "fit";
  if (!["fit", "fill", "stretch"].includes(scale)) {
    throw new ApiError("INVALID_IMAGE_REQUEST", "Unsupported image scale");
  }

  return roonSdkCall(
    "Roon image load",
    (callback) => image.get_image(
      imageKey,
      {
        scale,
        width: Math.floor(width),
        height: Math.floor(height),
        ...(options.format ? { format: options.format } : {})
      },
      (error: string | false, contentType: string, bytes: Buffer) =>
        callback(error, { contentType, bytes })
    ),
    { image_key: imageKey },
    { errorCode: "IMAGE_NOT_READY" }
  );
}

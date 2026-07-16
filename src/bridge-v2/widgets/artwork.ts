import { BridgeV2Context } from "../context";
import { getRoonImage } from "../../roon/roonImageService";
import { WidgetPayload } from "./viewService";

const THUMBNAIL_SIZE = 160;
const MAX_CONCURRENT_LOADS = 6;

type ArtworkTarget = {
  owner: Record<string, unknown>;
  imageKey: string;
};

function collectArtworkTargets(value: unknown, targets: ArtworkTarget[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectArtworkTargets(item, targets);
    return;
  }
  if (!value || typeof value !== "object") return;

  const owner = value as Record<string, unknown>;
  if (typeof owner.image_key === "string" && owner.image_key) {
    targets.push({ owner, imageKey: owner.image_key });
  }
  for (const child of Object.values(owner)) collectArtworkTargets(child, targets);
}

async function loadArtwork(context: BridgeV2Context, imageKey: string): Promise<string> {
  if (imageKey.startsWith("custom:")) {
    const cover = context.playlistService.getCustomCover(imageKey.slice("custom:".length));
    return `data:${cover.content_type};base64,${cover.bytes.toString("base64")}`;
  }

  const image = await getRoonImage(context.roonClient, imageKey, {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    scale: "fill",
    format: "image/jpeg"
  });
  return `data:${image.contentType};base64,${image.bytes.toString("base64")}`;
}

export async function embedWidgetArtwork(
  context: BridgeV2Context,
  widget: WidgetPayload
): Promise<WidgetPayload> {
  const targets: ArtworkTarget[] = [];
  collectArtworkTargets(widget, targets);
  const uniqueKeys = [...new Set(targets.map((target) => target.imageKey))];
  const images = new Map<string, string | null>();
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < uniqueKeys.length) {
      const imageKey = uniqueKeys[nextIndex++];
      try {
        images.set(imageKey, await loadArtwork(context, imageKey));
      } catch (error) {
        images.set(imageKey, null);
        context.logger.warn("Widget artwork could not be embedded", {
          imageKey,
          view: widget.view,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_LOADS, uniqueKeys.length) }, () => worker())
  );

  for (const target of targets) {
    target.owner.image_url = images.get(target.imageKey) || null;
  }
  const embedded = [...images.values()].filter(Boolean).length;
  widget.artwork_delivery = {
    mode: "inline_data_url",
    requested: uniqueKeys.length,
    embedded,
    failed: uniqueKeys.length - embedded
  };
  context.logger.info("Widget artwork embedding completed", {
    view: widget.view,
    requested: uniqueKeys.length,
    embedded,
    failed: uniqueKeys.length - embedded
  });
  return widget;
}

// Native: the picker's file URI is used as-is. The web build uses
// imageData.web.ts, which converts to durable data URLs.

export type StoredImage = { uri: string; width: number; height: number };

export function isEphemeralUri(_uri: string): boolean {
  return false;
}

export async function pickedImageToStored(asset: {
  uri: string;
  width?: number;
  height?: number;
}): Promise<StoredImage> {
  return { uri: asset.uri, width: asset.width ?? 1, height: asset.height ?? 1 };
}

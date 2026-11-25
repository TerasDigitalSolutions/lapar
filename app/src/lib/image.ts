/** Scale (w, h) down so the long edge is at most `max`; never upscales. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const k = max / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

const toBlob = (c: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));

/** Resize to `maxEdge` and encode WebP; JPEG when the browser returns another type. */
export async function resizeImage(blob: Blob, maxEdge: number, quality = 0.8): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const { width, height } = fitWithin(bmp.width, bmp.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('canvas unavailable');
  g.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const webp = await toBlob(canvas, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg', quality);
  if (!jpeg) throw new Error('image encode failed');
  return jpeg;
}

export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

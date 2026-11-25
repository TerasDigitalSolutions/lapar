import { resizeImage } from '../../lib/image';
import { run } from './authed';

/**
 * Resizes (long edge <= maxEdge, WebP 0.8, JPEG fallback) and uploads to the public `menu-staging`
 * bucket at `{prefix}/{uuid}.{ext}` (DATA-MODEL 9; the first folder is the shop id). Returns the public URL.
 */
export async function uploadImage(prefix: string, file: Blob, maxEdge = 1200): Promise<string> {
  const blob = await resizeImage(file, maxEdge, 0.8);
  const path = `${prefix}/${crypto.randomUUID()}.${blob.type === 'image/jpeg' ? 'jpg' : 'webp'}`;
  await run((c) => c.storage.from('menu-staging').upload(path, blob, { contentType: blob.type, upsert: false }));
  return (await run((c) => Promise.resolve({ data: c.storage.from('menu-staging').getPublicUrl(path).data, error: null }))).publicUrl;
}

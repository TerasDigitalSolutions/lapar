import { useState } from 'react';
import { resolvePhotoUrl } from '../lib/photo-url';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');

/** Square photo with an initials placeholder when there is no photo or it fails to load. Size via `className`. */
export function PhotoTile({ url, name, className = 'size-20' }: { url: string | null | undefined; name: string; className?: string }) {
  const src = resolvePhotoUrl(url);
  const [failed, setFailed] = useState<string | null>(null);
  const showImg = src && failed !== src;
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-xl bg-orange-100 ${className}`}>
      {showImg ? (
        <img src={src} alt={name} loading="lazy" decoding="async" onError={() => setFailed(src)} className="size-full object-cover" />
      ) : (
        <span aria-hidden="true" className="flex size-full items-center justify-center text-xl font-bold text-orange-800">
          {initials(name)}
        </span>
      )}
    </div>
  );
}

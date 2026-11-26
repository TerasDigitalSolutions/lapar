import { useEffect, useState } from 'react';

/** Sticky category chips. The active chip follows the section nearest the top of the screen. */
export function CategoryNav({ label, cats }: { label: string; cats: { id: string; name: string }[] }) {
  const [active, setActive] = useState(cats[0]?.id);
  const key = cats.map((c) => c.id).join();
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const ids = key.split(',');
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.id.slice(4);
          if (e.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        const first = ids.find((id) => seen.has(id));
        if (first) setActive(first);
      },
      { rootMargin: '-120px 0px -55% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(`cat-${id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key]);
  return (
    <nav aria-label={label} className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-stone-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur">
      {cats.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-current={c.id === active ? 'true' : undefined}
          className={`min-h-11 shrink-0 rounded-full px-5 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 ${
            c.id === active ? 'bg-orange-600 text-white shadow-sm' : 'bg-stone-100 text-stone-900 active:bg-orange-100'
          }`}
          onClick={() => {
            setActive(c.id);
            document.getElementById(`cat-${c.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          }}
        >
          {c.name}
        </button>
      ))}
    </nav>
  );
}

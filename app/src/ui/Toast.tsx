import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}
type Show = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<Show | null>(null);

const tone: Record<ToastKind, string> = {
  info: 'bg-stone-900 text-white',
  success: 'bg-green-700 text-white',
  error: 'bg-red-700 text-white',
};

export function ToastProvider({ children, durationMs = 4000 }: { children: ReactNode; durationMs?: number }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const show = useCallback<Show>(
    (message, kind = 'info') => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-2), { id, message, kind }]);
      setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), durationMs);
    },
    [durationMs],
  );
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:top-auto sm:bottom-0 sm:pt-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {items.map((i) => (
          <div key={i.id} className={`pointer-events-auto w-full max-w-md rounded-2xl px-4 py-3.5 text-base font-semibold shadow-xl ${tone[i.kind]}`}>
            {i.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `toast(message, kind?)`; kind is 'info' (default), 'success' or 'error'. */
export function useToast(): Show {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast() must be used inside <ToastProvider>');
  return show;
}

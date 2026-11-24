import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// Placeholder; M1 builds the offline demo. Must never import supabase-js.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">Lapar demo — coming soon</h1>
      <a href="../" className="mt-4 inline-flex min-h-12 items-center text-blue-700 underline">
        Back to the landing page
      </a>
    </main>
  </StrictMode>,
);

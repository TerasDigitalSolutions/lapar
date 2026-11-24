import { Suspense } from 'react';
import { Outlet, useRouteError } from 'react-router';

export function Loading() {
  return (
    <p role="status" className="p-6 text-center text-neutral-600">
      Loading…
    </p>
  );
}

export function Layout() {
  return (
    <Suspense fallback={<Loading />}>
      <Outlet />
    </Suspense>
  );
}

export function RouteError() {
  const err = useRouteError();
  return (
    <main className="mx-auto max-w-xl p-6" role="alert">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-neutral-600">{err instanceof Error ? err.message : 'Unexpected error'}</p>
      <a href="./" className="mt-4 inline-flex min-h-12 items-center underline">
        Back to start
      </a>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-bold">Page not found</h1>
      <a href="#/" className="mt-4 inline-flex min-h-12 items-center underline">
        Back to start
      </a>
    </main>
  );
}

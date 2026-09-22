'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * TanStack Query, scoped to mutations.
 *
 * Worth being precise about what it is doing here, because it is not the usual
 * job: the screens under this provider are server components, so Query holds no
 * list and caches no row. Reads stay on the server. What it provides is the
 * mutation lifecycle — `isPending` that stays true for the whole round trip,
 * and `onMutate`/`onError`/`onSettled` hooks to hang the optimistic overlay on.
 *
 * The client is created in state rather than at module scope so it is not
 * shared between requests during server rendering, which would leak one user's
 * in-flight state into another's.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: {
            // A failed write is reported, never retried silently. These are
            // side-effecting calls on mail — a quiet second attempt at "delete
            // forever" is not a resilience feature.
            retry: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

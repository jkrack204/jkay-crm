import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Live updates: keeps one event stream open to the server. When anyone changes
 * something (or a reminder fires) the server sends "changed" and we refetch
 * whatever is on screen — so a claimed lead leaves everyone's pool, a moved deal
 * moves on the Admin board, and the bell count updates without a reload.
 * The browser reconnects by itself if the connection drops.
 */
export function useLiveUpdates(meId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!meId || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      // a short pause so a burst of changes becomes one refetch
      timer = setTimeout(() => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' }), 300);
    };
    es.addEventListener('changed', (e) => {
      try {
        const { by } = JSON.parse((e as MessageEvent).data) as { by: string | null };
        // this tab made the change and already refreshed itself
        if (by === meId && document.hasFocus()) return;
      } catch {
        /* refresh anyway */
      }
      refresh();
    });
    // after a dropped connection, catch up on anything missed
    let opened = false;
    es.addEventListener('hello', () => {
      if (opened) refresh();
      opened = true;
    });
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [meId, qc]);
}

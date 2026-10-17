import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';

/**
 * Phase 1 shell. Each role gets its own area; nothing links across roles.
 *   /admin/*  Admin console     /cre/*  CRE desk     /bd/*  BD desk
 * Login, role routing and the real screens arrive in the next phases.
 */
function Health() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const r = await fetch('/api/health');
      if (!r.ok) throw new Error(`API answered ${r.status}`);
      return (await r.json()) as { ok: boolean; time: string };
    },
  });
  return (
    <div className="app-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="panel" style={{ padding: 24, minWidth: 320 }}>
        <div className="plate" style={{ fontWeight: 600, marginBottom: 8 }}>JKAY · RACKS CRM</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {isLoading ? 'Checking the server…' : error ? `Server not reachable — ${(error as Error).message}` : `Server OK · ${data?.time}`}
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Health />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

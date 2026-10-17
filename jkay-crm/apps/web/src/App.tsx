import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Role } from '@jkay/shared';
import { useMe, homeFor } from './lib/session';
import { Login } from './pages/Login';
import { CreDesk } from './desks/cre/CreDesk';
import { AdminConsole } from './desks/admin/AdminConsole';
import { BdDesk } from './desks/bd/BdDesk';

/** Each role lives in its own area; nothing links across roles. */
function Guard({ role, children }: { role: Role; children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <div className="center-note">Loading…</div>;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.role !== role) return <Navigate to={homeFor(me.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <div className="center-note">Loading…</div>;
  return <Navigate to={me ? homeFor(me.role) : '/login'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin/*" element={<Guard role="admin"><AdminConsole /></Guard>} />
      <Route path="/cre/*" element={<Guard role="cre"><CreDesk /></Guard>} />
      <Route path="/bd/*" element={<Guard role="bde"><BdDesk /></Guard>} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

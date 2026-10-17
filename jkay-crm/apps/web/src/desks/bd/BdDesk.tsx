import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { logout, useMe } from '../../lib/session';
import { ThemeSwitch } from '../../components/ui';

/** Placeholder until Phase 3 (BD desk). BDEs can log in and see this. */
export function BdDesk() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  return (
    <div className="login-wrap">
      <div className="login-theme">
        <ThemeSwitch />
      </div>
      <div className="soon">
        <b>BD desk — coming next</b>
        Hi {me?.fullName}. Deals handed to you by the CRE desk are already being recorded; the BD desk screens arrive in the next build.
        <div style={{ marginTop: 16 }}>
          <button
            className="btn btn-outline"
            onClick={async () => {
              await logout(qc);
              nav('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

/** Settings › Account — shared by every desk: who you are, change password, your sessions. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMe } from '../lib/session';
import { phone, when } from '../lib/format';
import { useAction } from './ui';

type Sess = { id: string; current: boolean; userAgent: string | null; ip: string | null; lastSeenAt: string; createdAt: string };

const device = (ua: string | null) => {
  if (!ua) return 'Unknown device';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${b}${os ? ' · ' + os : ''}`;
};

export function AccountSettings() {
  const { data: me } = useMe();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ sessions: Sess[] }>('/auth/sessions') });
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useAction(() => api.post('/auth/password', { current: cur, next }), { ok: 'Password updated · other sessions signed out', invalidate: [['sessions']] });
  const mismatch = !!confirm && next !== confirm;

  return (
    <div className="view active">
      <div className="set-wrap">
        <div className="flex-col gap-12" style={{ maxWidth: 680 }}>
          <div className="panel">
            <div className="panel__head">
              <h3>Profile</h3>
              <span className="count">Set by Admin</span>
            </div>
            <div className="panel__body">
              <div className="grid-2">
                <div className="field">
                  <label>Name</label>
                  <input value={me?.fullName ?? ''} readOnly />
                </div>
                <div className="field">
                  <label>Username</label>
                  <input value={me?.username ?? ''} readOnly />
                </div>
                <div className="field">
                  <label>Email (for alerts)</label>
                  <input value={me?.email ?? ''} readOnly />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input value={me?.phone ? phone(me.phone) : '—'} readOnly />
                </div>
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                Need a change here? Ask an Admin.
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h3>Password</h3>
              <span className="count">Changing it signs out your other devices</span>
            </div>
            <div className="panel__body flex-col gap-12">
              <div className="field">
                <label>Current password</label>
                <input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>New password</label>
                  <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" />
                </div>
                <div className="field">
                  <label>Confirm new password</label>
                  <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                  {mismatch && <span className="err-inline">Passwords don't match</span>}
                </div>
              </div>
              <div>
                <button
                  className="btn btn-signal"
                  disabled={!cur || next.length < 8 || next !== confirm || change.isPending}
                  onClick={() =>
                    change.mutate(undefined, {
                      onSuccess: () => {
                        setCur('');
                        setNext('');
                        setConfirm('');
                      },
                    })
                  }
                >
                  Update password
                </button>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h3>Signed-in devices</h3>
              <span className="count">{sessions.data?.sessions.length ?? 0}</span>
            </div>
            <div className="panel__body">
              {(sessions.data?.sessions ?? []).map((s) => (
                <div key={s.id} className="set-row">
                  <div className="set-row__text">
                    <div className="t">{device(s.userAgent)}</div>
                    <div className="d">
                      Signed in {when(s.createdAt)} · last active {when(s.lastSeenAt)}
                    </div>
                  </div>
                  {s.current && <span className="readonly-badge">this device</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

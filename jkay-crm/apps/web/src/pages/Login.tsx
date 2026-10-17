import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { homeFor } from '../lib/session';
import { ThemeSwitch } from '../components/ui';
import type { Me } from '../lib/types';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/login', { username, password });
      const { user } = await api.get<{ user: Me }>('/auth/me');
      qc.setQueryData(['me'], user);
      nav(homeFor(user.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-theme">
        <ThemeSwitch />
      </div>
      <div className="login-card">
        <div className="plate">
          JKAY<span>·</span>RACKS
        </div>
        <h1>Sign in</h1>
        <div className="sub">CRE desk, BD desk and Admin console</div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="u">Username</label>
            <input id="u" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="p">Password</label>
            <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="err">{error}</div>}
          <button className="btn btn-signal" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="foot">Forgot your password? Ask an Admin to reset it.</div>
      </div>
    </div>
  );
}

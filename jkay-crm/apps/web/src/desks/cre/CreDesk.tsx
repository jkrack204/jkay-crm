/**
 * CRE desk — ported from "JKAY RACKS - CRE Desk new.html".
 * Lists: Unclaimed Pool · My Leads (by stage) · Handed to BD · Lost, plus a
 * dashboard and settings. The lead record opens as a sheet over the list.
 */
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { logout, useConfig, useMe } from '../../lib/session';
import { initials } from '../../lib/format';
import { Bell, ThemeSwitch } from '../../components/ui';
import { CreList, type CreScope } from './CreList';
import { CreDashboard } from './CreDashboard';
import { AccountSettings } from '../../components/AccountSettings';

type Counts = { counts: Record<CreScope, number>; mineByStage: Record<string, number>; dueToday: number };

const TITLES: Record<CreScope, [string, string]> = {
  pool: ['Unclaimed Pool', 'Nobody owns these yet · claim one to work it'],
  mine: ['My Leads', 'Yours to work · call, follop, chase photos'],
  bd: ['Handed to BD', 'BD owns these now · you can only watch the stage'],
  lost: ['Lost', 'Closed lost · every record carries a reason'],
};

export function CreDesk() {
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const [search, setSearch] = useState('');

  const counts = useQuery({ queryKey: ['cre', 'counts'], queryFn: () => api.get<Counts>('/cre/counts'), refetchInterval: 30_000 });
  const workingStages = useMemo(() => (config?.stages ?? []).filter((s) => s.desk === 'cre' && s.kind === 'working'), [config]);

  useEffect(() => setNavOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t)) {
        e.preventDefault();
        document.getElementById('cre-search')?.focus();
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const path = loc.pathname.replace(/^\/cre\/?/, '') || 'pool';
  const scope = (['pool', 'mine', 'bd', 'lost'].includes(path) ? path : null) as CreScope | null;
  const stageId = params.get('stage');
  const stageName = stageId ? workingStages.find((s) => String(s.id) === stageId)?.name : undefined;
  const [title, crumb] =
    path === 'dashboard' ? ['Dashboard', 'Your numbers this week'] : path === 'settings' ? ['Settings', 'Your account'] : scope ? TITLES[scope] : TITLES.pool;

  const c = counts.data?.counts;
  const openLead = (id: string) => nav({ pathname: loc.pathname === '/cre' ? '/cre/pool' : loc.pathname, search: `?lead=${id}` });

  return (
    <div className="desk-cre">
      <div className="app-shell">
        <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
          <div className="sidebar__brand">
            <div className="plate">
              JKAY<span>·</span>RACKS
            </div>
            <div className="sub">CRE Desk</div>
          </div>
          <nav className="sidebar__nav">
            <NavGroup to="/cre/dashboard" label="Dashboard" active={path === 'dashboard'}>
              <div className="nav-pop__title">Your numbers</div>
              <NavItem to="/cre/dashboard" label="This week" />
              <NavItem to="/cre/mine" label="Follops due today" meta={counts.data?.dueToday} />
            </NavGroup>
            <NavGroup to="/cre/pool" label="Unclaimed Pool" active={scope === 'pool'}>
              <div className="nav-pop__title">Nobody owns these</div>
              <NavItem to="/cre/pool" label="Unclaimed leads" meta={c?.pool} />
            </NavGroup>
            <NavGroup to="/cre/mine" label="My Leads" active={scope === 'mine'}>
              <div className="nav-pop__title">Yours to work</div>
              <NavItem to="/cre/mine" label="All my leads" meta={c?.mine} on={scope === 'mine' && !stageId} />
              {workingStages.map((s) => (
                <NavItem key={s.id} to={`/cre/mine?stage=${s.id}`} label={s.name} meta={counts.data?.mineByStage[s.id] ?? 0} on={stageId === String(s.id)} />
              ))}
            </NavGroup>
            <NavGroup to="/cre/bd" label="Handed to BD" active={scope === 'bd'}>
              <div className="nav-pop__title">Read-only · BD owns these</div>
              <NavItem to="/cre/bd" label="All handed off" meta={c?.bd} />
            </NavGroup>
            <NavGroup to="/cre/lost" label="Lost" active={scope === 'lost'}>
              <div className="nav-pop__title">Closed lost · reason required</div>
              <NavItem to="/cre/lost" label="All lost" meta={c?.lost} />
            </NavGroup>
            <div className="nav-pop__title" style={{ padding: '11px 9px 4px' }}>
              Workspace
            </div>
            <NavGroup to="/cre/settings" label="Settings" active={path === 'settings'}>
              <div className="nav-pop__title">Account</div>
              <NavItem to="/cre/settings" label="Profile & password" />
            </NavGroup>
          </nav>
          <div className="sidebar__foot">
            <span className="lamp"></span>
            <span>{me?.fullName}</span>
            <ThemeSwitch />
          </div>
        </aside>
        {navOpen && <div className="nav-scrim open" onClick={() => setNavOpen(false)} />}

        <div className="main">
          <div className="topbar">
            <div className="topbar__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="nav-toggle" onClick={() => setNavOpen(true)} aria-label="Open navigation">
                ☰
              </button>
              <div>
                <h1>{stageName ?? title}</h1>
                <div className="crumb">{crumb}</div>
              </div>
            </div>
            <div className="topbar__right">
              {scope && (
                <div className="search-box">
                  <span style={{ color: 'var(--steel-500)' }}>⌕</span>
                  <input id="cre-search" type="text" placeholder="Search name, phone, place…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <span className="kbd-hint">/</span>
                </div>
              )}
              <Bell onOpenLead={openLead} />
              <div
                className="avatar"
                title="Sign out"
                style={{ cursor: 'pointer' }}
                onClick={async () => {
                  await logout(qc);
                  nav('/login');
                }}
              >
                {initials(me?.fullName ?? '')}
              </div>
            </div>
          </div>

          <div className="content">
            <Routes>
              <Route path="dashboard" element={<CreDashboard />} />
              <Route path="settings" element={<AccountSettings />} />
              <Route path="pool" element={<CreList scope="pool" search={search} />} />
              <Route path="mine" element={<CreList scope="mine" search={search} stageId={stageId} />} />
              <Route path="bd" element={<CreList scope="bd" search={search} />} />
              <Route path="lost" element={<CreList scope="lost" search={search} />} />
              <Route path="*" element={<CreList scope="pool" search={search} />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavGroup({ to, label, active, children }: { to: string; label: string; active: boolean; children: React.ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="nav-group">
      <div className={`nav-parent ${active ? 'active' : ''}`} onClick={() => nav(to)}>
        <span className="dot"></span>
        {label}
        <span className="caret">▸</span>
      </div>
      <div className="nav-pop">{children}</div>
    </div>
  );
}

function NavItem({ to, label, meta, on }: { to: string; label: string; meta?: number; on?: boolean }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-pop__item ${on ?? isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }} end>
      <span className="lab">{label}</span>
      {meta !== undefined && <span className="meta">{meta}</span>}
    </NavLink>
  );
}

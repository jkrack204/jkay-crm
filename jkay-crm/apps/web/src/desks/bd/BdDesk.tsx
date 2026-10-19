/**
 * BD desk — ported from "JKAY RACKS - BD Desk new.html".
 * Deals handed over by the CRE desk: site measurement → drawings → quotations →
 * won (payments) or lost. The deal record opens as a sheet over the list.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Logo } from '../../components/Logo';
import { logout, useConfig, useMe } from '../../lib/session';
import { initials } from '../../lib/format';
import { Bell, ThemeSwitch } from '../../components/ui';
import { AccountSettings } from '../../components/AccountSettings';
import { BdPipeline } from './BdPipeline';
import { BdDashboard } from './BdDashboard';
import { BdVisits } from './BdVisits';
import { BdPayments } from './BdPayments';
import { BdWorkspace } from './BdWorkspace';
import { bdStagesOf, useDeals } from './bdShared';

export function BdDesk() {
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const deals = useDeals();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => setNavOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t)) {
        e.preventDefault();
        document.getElementById('bd-search')?.focus();
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const path = loc.pathname.replace(/^\/bd\/?/, '').split('/')[0] || 'deals';
  const stageId = params.get('stage');
  const stages = bdStagesOf(config?.stages);
  const stage = stageId ? stages.find((s) => String(s.id) === stageId) : undefined;

  const list = deals.data?.deals ?? [];
  const n = useMemo(() => {
    const open = list.filter((d) => !d.wonAt && !d.lostAt);
    const won = list.filter((d) => d.wonAt && !d.lostAt);
    const first = stages.find((s) => s.kind === 'working');
    return {
      all: list.filter((d) => !d.lostAt).length,
      open: open.length,
      lost: list.filter((d) => d.lostAt).length,
      won: won.length,
      owing: won.filter((d) => (d.balance ?? 0) > 0).length,
      booked: open.filter((d) => d.visit?.status === 'booked').length,
      unbooked: open.filter((d) => d.stage?.id === first?.id && d.visit?.status !== 'booked').length,
      byStage: (id: number) => list.filter((d) => d.stage?.id === id && !d.lostAt).length,
    };
  }, [list, stages]);

  const TITLES: Record<string, [string, string]> = {
    dashboard: ['Dashboard', 'Your month across every deal you own'],
    deals: [stage?.name ?? 'My deals', stage?.definition ?? 'Every deal handed over to you by a CRE'],
    lost: ['Lost', 'Closed lost · every record carries a reason'],
    visits: ['Site visits', 'Measurement calendar'],
    payments: ['Payments', 'Won deals · advance, installments, balance'],
    owing: ['Payments', 'Won deals with a balance still to come'],
    settings: ['Settings', 'Your account and password'],
    rules: ['Settings', 'Deal rules and the tags Admin issued'],
    notes: ['My notes', 'Every private note you have written'],
  };
  const [title, crumb] = TITLES[path] ?? TITLES.deals!;
  const showSearch = path === 'deals' || path === 'lost';
  const openDeal = (id: string) => nav(`/bd/${path === 'lost' ? 'lost' : 'deals'}?deal=${id}`);

  return (
    <div className="desk-bd">
      <div className="app-shell">
        <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
          <div className="sidebar__brand">
            <div className="plate">
              <Logo height={17} />
            </div>
            <div className="sub">BD Desk</div>
          </div>
          <nav className="sidebar__nav">
            <NavGroup to="/bd/dashboard" label="Dashboard" active={path === 'dashboard'}>
              <div className="nav-pop__title">Your numbers</div>
              <NavItem to="/bd/dashboard" label="This month" />
              <NavItem to="/bd/deals" label="Open deals" meta={n.open} on={false} />
            </NavGroup>
            <NavGroup to="/bd/deals" label="My deals" active={path === 'deals'}>
              <div className="nav-pop__title">Site measurement → won / lost</div>
              <NavItem to="/bd/deals" label="All my deals" meta={n.all} on={path === 'deals' && !stageId} />
              {stages
                .filter((s) => s.kind !== 'lost')
                .map((s) => (
                  <NavItem key={s.id} to={`/bd/deals?stage=${s.id}`} label={s.name} meta={n.byStage(s.id)} on={stageId === String(s.id)} />
                ))}
            </NavGroup>
            <NavGroup to="/bd/visits" label="Site visits" active={path === 'visits'}>
              <div className="nav-pop__title">Measurement calendar</div>
              <NavItem to="/bd/visits" label="This week" meta={n.booked} />
              <NavItem to="/bd/visits" label="Awaiting measurement" meta={n.unbooked} on={false} />
            </NavGroup>
            <NavGroup to="/bd/payments" label="Payments" active={path === 'payments' || path === 'owing'}>
              <div className="nav-pop__title">Won deals only</div>
              <NavItem to="/bd/payments" label="Balance ledger" meta={n.won} />
              <NavItem to="/bd/owing" label="Balance still due" meta={n.owing} />
            </NavGroup>
            <NavGroup to="/bd/lost" label="Lost" active={path === 'lost'}>
              <div className="nav-pop__title">Dropped by BD · reason required</div>
              <NavItem to="/bd/lost" label="All lost deals" meta={n.lost} />
            </NavGroup>
            <div className="nav-pop__title" style={{ padding: '11px 9px 4px' }}>
              Workspace
            </div>
            <NavGroup to="/bd/settings" label="Settings" active={['settings', 'rules', 'notes'].includes(path)}>
              <div className="nav-pop__title">Account</div>
              <NavItem to="/bd/settings" label="Profile & password" />
              <div className="nav-pop__title">Workspace</div>
              <NavItem to="/bd/rules" label="Deal rules & tags" />
              <NavItem to="/bd/notes" label="My notes" />
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
                <h1>{title}</h1>
                <div className="crumb">{crumb}</div>
              </div>
            </div>
            <div className="topbar__right">
              {showSearch && (
                <div className="search-box">
                  <span style={{ color: 'var(--steel-500)' }}>⌕</span>
                  <input id="bd-search" type="text" placeholder="Search client, place, CRE…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <span className="kbd-hint">/</span>
                </div>
              )}
              <Bell onOpenLead={openDeal} footer="Hand-offs, visits, discount decisions and payments arrive here." />
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
              <Route path="dashboard" element={<BdDashboard />} />
              <Route path="deals" element={<BdPipeline scope="all" stageId={stageId} search={search} />} />
              <Route path="lost" element={<BdPipeline scope="lost" stageId={null} search={search} />} />
              <Route path="visits" element={<BdVisits />} />
              <Route path="payments" element={<BdPayments filter="all" />} />
              <Route path="owing" element={<BdPayments filter="awaiting" />} />
              <Route path="settings" element={<AccountSettings />} />
              <Route path="rules" element={<BdWorkspace pane="rules" />} />
              <Route path="notes" element={<BdWorkspace pane="notes" />} />
              <Route path="*" element={<Navigate to="/bd/deals" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavGroup({ to, label, active, children }: { to: string; label: string; active: boolean; children: ReactNode }) {
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
    <NavLink to={to} className={({ isActive }) => `nav-pop__item ${(on ?? isActive) ? 'on' : ''}`} style={{ textDecoration: 'none' }} end>
      <span className="lab">{label}</span>
      {meta !== undefined && <span className="meta">{meta}</span>}
    </NavLink>
  );
}

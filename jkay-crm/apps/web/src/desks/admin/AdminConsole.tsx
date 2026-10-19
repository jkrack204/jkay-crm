/**
 * Admin console — ported from "JKAY RACKS - Admin Console new.html".
 * Phase 2 ships Employees + "Add a lead by hand"; Phase 3 adds Discount approvals; the rest follow in Phase 4.
 */
import { useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PLATFORMS, PLATFORM_LABEL, ROLES, type Role } from '@jkay/shared';
import { api } from '../../lib/api';
import { Logo } from '../../components/Logo';
import { logout, useConfig, useMe } from '../../lib/session';
import { initials, phone } from '../../lib/format';
import type { Employee } from '../../lib/types';
import { Bell, Modal, ThemeSwitch, useAction, useToast } from '../../components/ui';
import { AccountSettings } from '../../components/AccountSettings';
import { DiscountApprovals } from './DiscountApprovals';

const NAV: ({ sec: string } | { to: string; label: string })[] = [
  { sec: 'Analytics' },
  { to: '/admin/dashboard', label: 'Dashboard' },
  { sec: 'Desks' },
  { to: '/admin/cre', label: 'CRE desk' },
  { to: '/admin/bd', label: 'BD desk' },
  { sec: 'Pipeline' },
  { to: '/admin/pipeline', label: 'Sales pipeline' },
  { to: '/admin/discounts', label: 'Discount approvals' },
  { sec: 'Closed' },
  { to: '/admin/closed', label: 'Deal closed' },
  { to: '/admin/payments', label: 'Payments' },
  { to: '/admin/lost', label: 'Lost' },
  { sec: 'System' },
  { to: '/admin/employees', label: 'Employees' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/account', label: 'My account' },
];
const TITLES: Record<string, [string, string]> = {
  dashboard: ['Dashboard', 'Where leads come from, how each person performs, and where deals fall out'],
  cre: ['CRE desk', 'Every lead on the CRE side · filter by executive'],
  bd: ['BD desk', 'Every deal handed to BD · filter by BDE'],
  pipeline: ['Sales pipeline', 'Every live lead and deal in your own ranking'],
  discounts: ['Discount approvals', 'BDE requests past the discount limit · first Admin to decide wins'],
  closed: ['Deal closed', 'Won deals only'],
  payments: ['Payments', 'Received and outstanding on every won deal'],
  lost: ['Lost', 'CRE lost and BD lost, kept apart'],
  employees: ['Employees', 'Who can log in, and to which desk'],
  settings: ['Settings', 'Integrations, tags and the stage definitions every desk follows'],
  account: ['My account', 'Your password and signed-in devices'],
};

export function AdminConsole() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [navOpen, setNavOpen] = useState(false);
  const [addLead, setAddLead] = useState(false);
  const key = loc.pathname.replace(/^\/admin\/?/, '').split('/')[0] || 'employees';
  const [title, crumb] = TITLES[key] ?? TITLES.employees!;

  return (
    <div className="desk-admin">
      <div className="app-shell">
        <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
          <div className="sidebar__brand">
            <div className="plate">
              <Logo height={17} />
            </div>
            <div className="sub">Admin</div>
          </div>
          <nav className="sidebar__nav">
            {NAV.map((n, i) =>
              'sec' in n ? (
                <div key={i} className="nav-sec">
                  {n.sec}
                </div>
              ) : (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item ${isActive || (key === 'employees' && n.to === '/admin/employees') ? 'active' : ''}`} onClick={() => setNavOpen(false)}>
                  <span className="dot"></span>
                  {n.label}
                </NavLink>
              ),
            )}
          </nav>
          <div className="sidebar__foot">
            <span className="lamp"></span>
            {me?.fullName} · Admin
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
              <button className="btn btn-signal btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setAddLead(true)}>
                + Add lead
              </button>
              <Bell onOpenLead={(_id, kind) => (kind === 'discount' ? nav('/admin/discounts') : toast('Lead records open from the Admin desks in the next build'))} />
              <div
                className="avatar"
                title="Sign out"
                style={{ cursor: 'pointer' }}
                onClick={async () => {
                  await logout(qc);
                  nav('/login');
                }}
              >
                {initials(me?.fullName ?? 'AD')}
              </div>
            </div>
          </div>

          <div className="content">
            <div className="wrap">
              <Routes>
                <Route path="employees" element={<Employees />} />
                <Route path="discounts" element={<DiscountApprovals />} />
                <Route path="account" element={<AccountSettings />} />
                <Route path="*" element={key === 'employees' ? <Employees /> : <Soon what={title} />} />
              </Routes>
            </div>
          </div>
        </div>
      </div>
      {addLead && <AddLeadModal onClose={() => setAddLead(false)} />}
    </div>
  );
}

function Soon({ what }: { what: string }) {
  return (
    <div className="soon">
      <b>{what} — in a later build</b>
      This screen is part of the Admin console build (Phase 4). Employees and “Add lead” work now.
    </div>
  );
}

/* ------------------------------- employees -------------------------------- */
const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', cre: 'CRE', bde: 'BDE' };
const rolePill = (r: Role) => (r === 'cre' ? 'blue' : r === 'bde' ? 'amber' : 'violet');

function Employees() {
  const list = useQuery({ queryKey: ['employees'], queryFn: () => api.get<{ employees: Employee[] }>('/employees') });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [resetting, setResetting] = useState<Employee | null>(null);
  const rows = list.data?.employees ?? [];
  const n = (r: Role) => rows.filter((e) => e.role === r && e.active).length;

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <span className="lbl">
          {rows.filter((e) => e.active).length} active · {n('cre')} CRE · {n('bde')} BDE · {n('admin')} Admin
        </span>
        <div style={{ flex: 1 }}></div>
        <button className="btn btn-signal btn-sm" onClick={() => setAdding(true)}>
          + Add employee
        </button>
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Territory</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={8} className="empty">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id} style={{ opacity: e.active ? 1 : 0.55 }}>
                <td>
                  <span className="who">
                    <span className="av" style={{ background: 'var(--accent-tint)', color: 'var(--accent-hover)' }}>
                      {initials(e.fullName)}
                    </span>
                    {e.fullName}
                  </span>
                </td>
                <td>{e.username}</td>
                <td>
                  <span className={`pill ${rolePill(e.role)}`}>
                    <i></i>
                    {ROLE_LABEL[e.role]}
                  </span>
                </td>
                <td>{e.territory || '—'}</td>
                <td>{e.phone ? phone(e.phone) : '—'}</td>
                <td>{e.email}</td>
                <td>
                  {e.active ? (
                    <span className="pill green">
                      <i></i>Active
                    </span>
                  ) : (
                    <span className="pill">
                      <i></i>Disabled
                    </span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditing(e)}>
                    Edit
                  </button>{' '}
                  <button className="btn btn-outline btn-sm" onClick={() => setResetting(e)}>
                    Reset password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pipe-hint" style={{ marginTop: 12 }}>
        <span>◆</span>A CRE gets the CRE desk, a BDE gets the BD desk, an Admin gets this console. People log in with their username; the email is only for alerts. Disabling someone signs them out at once.
      </div>
      {adding && <EmployeeModal onClose={() => setAdding(false)} />}
      {editing && <EmployeeModal emp={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordModal emp={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}

function EmployeeModal({ emp, onClose }: { emp?: Employee; onClose: () => void }) {
  const [f, setF] = useState({
    fullName: emp?.fullName ?? '',
    username: emp?.username ?? '',
    password: '',
    role: (emp?.role ?? 'cre') as Role,
    email: emp?.email ?? '',
    phone: emp?.phone ? `+${emp.phone}` : '',
    territory: emp?.territory ?? '',
    active: emp?.active ?? true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  const save = useAction(
    () =>
      emp
        ? api.patch(`/employees/${emp.id}`, { fullName: f.fullName, role: f.role, email: f.email, phone: f.phone || null, territory: f.territory || null, active: f.active })
        : api.post('/employees', { fullName: f.fullName, username: f.username, password: f.password, role: f.role, email: f.email, phone: f.phone || undefined, territory: f.territory || undefined }),
    { ok: emp ? `${f.fullName} updated` : `${f.fullName} added as ${ROLE_LABEL[f.role]}`, invalidate: [['employees']] },
  );
  const ok = f.fullName.trim().length >= 2 && /\S+@\S+\.\S+/.test(f.email) && (emp || (f.username.length >= 3 && f.password.length >= 8));
  return (
    <Modal
      title={emp ? `Edit ${emp.fullName}` : 'Add employee'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-signal" disabled={!ok || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {emp ? 'Save' : 'Add employee'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Full name</label>
        <input value={f.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="e.g. Kavya Raman" autoFocus />
      </div>
      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Username {emp && '(fixed)'}</label>
          <input value={f.username} onChange={(e) => set('username', e.target.value.toLowerCase())} disabled={!!emp} placeholder="kavya" autoCapitalize="none" />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={f.role} onChange={(e) => set('role', e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!emp && (
        <div className="field">
          <label>First password</label>
          <input type="text" value={f.password} onChange={(e) => set('password', e.target.value)} placeholder="At least 8 characters — tell them in person" autoComplete="off" />
        </div>
      )}
      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Email (for alerts)</label>
          <input value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" />
        </div>
        <div className="field">
          <label>Phone</label>
          <input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 …" />
        </div>
      </div>
      <div className="field">
        <label>Territory</label>
        <input value={f.territory} onChange={(e) => set('territory', e.target.value)} placeholder="Coimbatore · Erode" />
      </div>
      {emp && (
        <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active — can log in
        </label>
      )}
    </Modal>
  );
}

function ResetPasswordModal({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const go = useAction(() => api.post(`/employees/${emp.id}/password`, { password: pw }), { ok: `New password set for ${emp.fullName} — they've been signed out` });
  return (
    <Modal
      title={`Reset password · ${emp.fullName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-signal" disabled={pw.length < 8 || go.isPending} onClick={() => go.mutate(undefined, { onSuccess: onClose })}>
            Set password
          </button>
        </>
      }
    >
      <div className="field">
        <label>New password</label>
        <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" autoComplete="off" autoFocus />
      </div>
      <div className="hint">They're signed out everywhere and log in with this. Tell them in person; they can change it under Settings.</div>
    </Modal>
  );
}

/* ------------------------------ add a lead -------------------------------- */
function AddLeadModal({ onClose }: { onClose: () => void }) {
  const { data: config } = useConfig();
  const emp = useQuery({ queryKey: ['employees'], queryFn: () => api.get<{ employees: Employee[] }>('/employees') });
  const [f, setF] = useState({ customerName: '', phone: '', place: '', platform: 'walkin', estimate: '', requirement: '', route: 'pool' as 'pool' | 'cre' | 'bd', ownerId: '', stageId: '', note: '' });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const people = (emp.data?.employees ?? []).filter((e) => e.active && e.role === (f.route === 'cre' ? 'cre' : 'bde'));
  const stages = (config?.stages ?? []).filter((s) => s.desk === (f.route === 'bd' ? 'bd' : 'cre') && s.kind === 'working');
  const owner = f.ownerId || people[0]?.id || '';
  const save = useAction(
    () =>
      api.post('/leads', {
        customerName: f.customerName,
        phone: f.phone || undefined,
        place: f.place || undefined,
        platform: f.platform,
        estimate: f.estimate ? Number(f.estimate.replace(/\D/g, '')) : undefined,
        requirement: f.requirement || undefined,
        route: f.route,
        ...(f.route !== 'pool' ? { ownerId: owner, stageId: f.stageId ? Number(f.stageId) : undefined } : {}),
        note: f.note || undefined,
      }),
    { ok: `${f.customerName} added${f.route === 'pool' ? ' to the unclaimed pool' : ''}`, invalidate: [['cre'], ['notifications']] },
  );
  const hint =
    f.route === 'pool'
      ? 'It lands in the shared pool — the first CRE to claim it owns it.'
      : f.route === 'cre'
        ? 'It appears on that CRE’s desk as a claimed lead, and the hand-off to BD still runs the normal way.'
        : 'Skips the CRE desk. Recorded as qualified by you, so the funnel counts it as an admin hand-off.';
  return (
    <Modal
      title="Add a lead by hand"
      width={620}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-signal" disabled={!f.customerName.trim() || (f.route !== 'pool' && !owner) || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Add lead
          </button>
        </>
      }
    >
      <div className="field">
        <label>Customer / firm name</label>
        <input value={f.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="e.g. Anjali Supermart" autoFocus />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Phone</label>
          <input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 …" />
        </div>
        <div className="field">
          <label>Place</label>
          <input value={f.place} onChange={(e) => set('place', e.target.value)} placeholder="City, state" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Lead source</label>
          <select value={f.platform} onChange={(e) => set('platform', e.target.value)}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Rough requirement value (₹)</label>
          <input value={f.estimate} onChange={(e) => set('estimate', e.target.value)} placeholder="e.g. 180000" inputMode="numeric" />
        </div>
      </div>
      <div className="field">
        <label>Requirement</label>
        <input value={f.requirement} onChange={(e) => set('requirement', e.target.value)} placeholder="What they asked for" />
      </div>
      <div className="field">
        <label>Where does it go</label>
        <div className="lead-modes">
          {(
            [
              ['pool', 'Unclaimed pool'],
              ['cre', 'Assign to a CRE'],
              ['bd', 'Straight to a BDE'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`chip ${f.route === k ? 'on' : ''}`} onClick={() => setF({ ...f, route: k, ownerId: '', stageId: '' })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {f.route !== 'pool' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>{f.route === 'cre' ? 'CRE who owns it' : 'BDE who closes it'}</label>
            <select value={owner} onChange={(e) => set('ownerId', e.target.value)}>
              {people.length === 0 && <option value="">No active {f.route === 'cre' ? 'CREs' : 'BDEs'} yet</option>}
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Opening stage</label>
            <select value={f.stageId} onChange={(e) => set('stageId', e.target.value)}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="field">
        <label>Admin note (optional — private to you)</label>
        <textarea rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Anything you want on record." />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>{hint}</div>
    </Modal>
  );
}


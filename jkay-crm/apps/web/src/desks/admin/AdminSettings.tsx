/**
 * Admin › Settings — the stage definitions, tag library, categories, rules and
 * WhatsApp templates every desk works to. Changes apply to everyone at once.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PLATFORMS, TONES, type Desk, type TagScope, type Tone } from '@jkay/shared';
import { api } from '../../lib/api';
import type { Stage, Tag, Template } from '../../lib/types';
import { Modal, useAction } from '../../components/ui';
import { Pill, platformName, tonePill } from './adminShared';

type LibStage = Stage & { live: number };
type LibTag = Tag & { used: number };
type Library = {
  stages: LibStage[];
  tags: LibTag[];
  categories: { id: number; name: string; used: number }[];
  templates: Template[];
  settings: { key: string; label: string; min: number; max: number; value: number }[];
};
const inv = [['admin', 'library'], ['config'], ['admin', 'records']];
const useLibrary = () => useQuery({ queryKey: ['admin', 'library'], queryFn: () => api.get<Library>('/admin/library') });

const TABS = [
  ['stages', 'Stage definitions'],
  ['tags', 'Tags & lost reasons'],
  ['categories', 'Product categories'],
  ['rules', 'Rules & alerts'],
  ['templates', 'WhatsApp templates'],
  ['sources', 'Lead sources'],
] as const;
type TabKey = (typeof TABS)[number][0];

export function AdminSettings() {
  const [p, setP] = useSearchParams();
  const tab = (TABS.find((t) => t[0] === p.get('tab'))?.[0] ?? 'stages') as TabKey;
  const lib = useLibrary();
  return (
    <div className="set-grid">
      <div className="set-rail">
        <div className="set-rail__g">Settings</div>
        {TABS.map(([k, l]) => (
          <a key={k} className={tab === k ? 'on' : ''} onClick={() => setP({ tab: k })}>
            {l}
          </a>
        ))}
      </div>
      <div style={{ minWidth: 0 }}>
        {lib.isLoading || !lib.data ? (
          <div className="empty">{lib.isError ? (lib.error as Error).message : 'Loading…'}</div>
        ) : tab === 'stages' ? (
          <Stages lib={lib.data} />
        ) : tab === 'tags' ? (
          <Tags lib={lib.data} />
        ) : tab === 'categories' ? (
          <Categories lib={lib.data} />
        ) : tab === 'rules' ? (
          <Rules lib={lib.data} />
        ) : tab === 'templates' ? (
          <Templates lib={lib.data} />
        ) : (
          <Sources />
        )}
      </div>
    </div>
  );
}

/* --------------------------------- stages -------------------------------- */
const KIND_NOTE: Record<string, string> = {
  pool: 'where new leads land',
  handoff: 'set by "Hand off to BD"',
  won: 'set by the advance / Won',
  lost: 'set by "Mark lost"',
};
function Stages({ lib }: { lib: Library }) {
  return (
    <>
      <div className="pipe-hint">
        <span>◆</span>These are the stages every desk works to. Renaming a stage or its definition updates it for every CRE and BDE at once. Stages marked with a role (pool, hand-off, won, lost) drive the workflow, so they can be renamed but not removed.
      </div>
      <StagePanel lib={lib} desk="cre" title="CRE desk — lead stages" />
      <StagePanel lib={lib} desk="bd" title="BD desk — deal stages" />
    </>
  );
}
function StagePanel({ lib, desk, title }: { lib: Library; desk: Desk; title: string }) {
  const list = lib.stages.filter((s) => s.desk === desk).sort((a, b) => a.position - b.position);
  const working = list.filter((s) => s.kind === 'working');
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const order = useAction((ids: number[]) => api.post('/admin/stages/order', { desk, ids }), { ok: 'Order saved', invalidate: inv });
  const del = useAction((id: number) => api.del(`/admin/stages/${id}`), { ok: 'Stage removed', invalidate: inv });
  const move = (id: number, dir: -1 | 1) => {
    const ids = working.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    order.mutate(ids);
  };
  return (
    <div className="panel" style={{ marginBottom: 13 }}>
      <div className="panel__head">
        <h3>{title}</h3>
        <span className="count">{list.length} stages</span>
      </div>
      <div className="panel__body">
        {list.map((s, i) =>
          editing === s.id ? (
            <StageEdit key={s.id} s={s} n={i + 1} onDone={() => setEditing(null)} />
          ) : (
            <div key={s.id} className="sd-row">
              <div className="num">{i + 1}</div>
              <div>
                <div className="nm">
                  {s.name}{' '}
                  {s.kind !== 'working' && (
                    <span className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>
                      · {KIND_NOTE[s.kind]}
                    </span>
                  )}
                </div>
                <div className="df">{s.definition || <span className="muted">No definition yet.</span>}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                  {s.requiresFollowup && <Pill tone="amber">needs a follop date</Pill>}
                  {s.requiresStageTag && <Pill tone="amber">needs a stage tag</Pill>}
                  {s.requiresQuotation && <Pill tone="blue">needs a quotation</Pill>}
                  {s.showsValue && <Pill tone="green">shows the value</Pill>}
                  {s.live > 0 && <Pill>{s.live} open here</Pill>}
                </div>
              </div>
              <div className="ac">
                {s.kind === 'working' && (
                  <>
                    <button className="btn btn-outline btn-sm" title="Move up" disabled={working[0]?.id === s.id || order.isPending} onClick={() => move(s.id, -1)}>
                      ↑
                    </button>
                    <button className="btn btn-outline btn-sm" title="Move down" disabled={working.at(-1)?.id === s.id || order.isPending} onClick={() => move(s.id, 1)}>
                      ↓
                    </button>
                  </>
                )}
                <button className="btn btn-outline btn-sm" onClick={() => setEditing(s.id)}>
                  Edit
                </button>
                {s.kind === 'working' && (
                  <button
                    className="btn btn-outline btn-sm"
                    title={s.live ? 'Move the open records out first' : 'Remove stage'}
                    disabled={s.live > 0 || del.isPending}
                    onClick={() => confirm(`Remove "${s.name}"?`) && del.mutate(s.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ),
        )}
        {adding ? (
          <NewStage desk={desk} onDone={() => setAdding(false)} />
        ) : (
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
            + Add a {desk === 'cre' ? 'CRE' : 'BD'} stage
          </button>
        )}
      </div>
    </div>
  );
}
function StageEdit({ s, n, onDone }: { s: LibStage; n: number; onDone: () => void }) {
  const [f, setF] = useState({ name: s.name, definition: s.definition, requiresFollowup: s.requiresFollowup, requiresStageTag: s.requiresStageTag, showsValue: s.showsValue, requiresQuotation: s.requiresQuotation });
  const save = useAction(() => api.patch(`/admin/stages/${s.id}`, f), { ok: 'Stage updated', invalidate: inv });
  const flag = (k: keyof typeof f, label: string) => (
    <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" checked={f[k] as boolean} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <div className="sd-row">
      <div className="num">{n}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <input className="set-ctl" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ width: '100%' }} />
        <textarea className="set-ctl" rows={2} value={f.definition} onChange={(e) => setF({ ...f, definition: e.target.value })} style={{ width: '100%', resize: 'vertical' }} placeholder="What this stage means — every desk sees it" />
        {s.kind === 'working' && s.desk === 'cre' && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {flag('requiresFollowup', 'Needs a next follop date')}
            {flag('requiresStageTag', 'Needs one of its stage tags')}
          </div>
        )}
        {s.kind === 'working' && s.desk === 'bd' && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {flag('requiresQuotation', 'Needs a quotation to enter')}
            {flag('showsValue', 'Shows the deal value')}
          </div>
        )}
      </div>
      <div className="ac">
        <button className="btn btn-signal btn-sm" disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onDone })}>
          Save
        </button>
        <button className="btn btn-outline btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
function NewStage({ desk, onDone }: { desk: Desk; onDone: () => void }) {
  const [name, setName] = useState('');
  const [definition, setDef] = useState('');
  const add = useAction(() => api.post('/admin/stages', { desk, name, definition }), { ok: `${name} added`, invalidate: inv });
  return (
    <div className="newrow">
      <input className="n" placeholder="Stage name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input className="d" placeholder="What it means" value={definition} onChange={(e) => setDef(e.target.value)} />
      <button className="btn btn-signal btn-sm" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: onDone })}>
        Add stage
      </button>
      <button className="btn btn-outline btn-sm" onClick={onDone}>
        Cancel
      </button>
      <div className="hint" style={{ flexBasis: '100%' }}>
        It's added as the last working stage, before {desk === 'cre' ? 'the hand-off' : 'Won'}. Use the arrows to move it.
      </div>
    </div>
  );
}

/* ---------------------------------- tags --------------------------------- */
const TONE_SWATCH: Record<Tone, [string, string]> = {
  neutral: ['var(--steel-850)', 'var(--steel-700)'],
  green: ['color-mix(in srgb,var(--signal-green) 40%,transparent)', 'var(--signal-green)'],
  amber: ['var(--accent-tint)', 'var(--signal-amber)'],
  red: ['color-mix(in srgb,var(--signal-red) 35%,transparent)', 'var(--signal-red)'],
  blue: ['color-mix(in srgb,var(--signal-blue) 35%,transparent)', 'var(--signal-blue)'],
  violet: ['color-mix(in srgb,var(--signal-violet) 35%,transparent)', 'var(--signal-violet)'],
};
function Tags({ lib }: { lib: Library }) {
  const creStages = lib.stages.filter((s) => s.desk === 'cre' && s.kind === 'working').sort((a, b) => a.position - b.position);
  const groups: { title: string; who: string; desc: string; scope: TagScope; stageId?: number; adm?: boolean }[] = [
    ...creStages
      .filter((s) => s.requiresStageTag || lib.tags.some((t) => t.stageId === s.id))
      .map((s) => ({ title: `${s.name} — stage tags`, who: 'CRE desk', desc: `A CRE picks one of these when moving a lead into ${s.name}.`, scope: 'cre' as const, stageId: s.id })),
    { title: 'CRE lead tags', who: 'CRE desk', desc: 'What a CRE can stick on a lead while working it.', scope: 'cre' },
    { title: 'BD deal tags', who: 'BD desk', desc: 'What a BDE can stick on a deal after hand-off.', scope: 'bd' },
    { title: 'Admin-only tags', who: 'Admins', desc: 'Used to rank the sales pipeline. Each Admin applies them privately; no CRE or BDE ever sees them.', scope: 'admin', adm: true },
    { title: 'CRE lost reasons', who: 'CRE desk', desc: 'A CRE must pick one when closing a lead as lost.', scope: 'cre_lost' },
    { title: 'BD lost reasons', who: 'BD desk', desc: 'A BDE must pick one when closing a deal as lost.', scope: 'bd_lost' },
  ];
  const inGroup = (g: (typeof groups)[number]) => lib.tags.filter((t) => t.scope === g.scope && (g.stageId ? t.stageId === g.stageId : !t.stageId));
  return (
    <>
      <div className="pipe-hint">
        <span>◆</span>Every tag a CRE or a BDE can put on a lead or a deal is created here. Nobody else can invent one — the desks only pick from these lists. Removing a tag hides it from the pickers; records that already carry it keep it.
      </div>
      <div className="stat-strip" style={{ marginBottom: 14 }}>
        <div className="st">
          <div className="l">Tags defined</div>
          <div className="v">{lib.tags.length}</div>
          <div className="d">across {groups.length} lists</div>
        </div>
        <div className="st">
          <div className="l">Lost reasons</div>
          <div className="v">{lib.tags.filter((t) => t.scope.endsWith('_lost')).length}</div>
          <div className="d">forced choice on close</div>
        </div>
        <div className="st">
          <div className="l">Admin-only</div>
          <div className="v">{lib.tags.filter((t) => t.scope === 'admin').length}</div>
          <div className="d">private to each Admin</div>
        </div>
      </div>
      {groups.map((g) => (
        <TagGroup key={g.title} g={g} tags={inGroup(g)} />
      ))}
    </>
  );
}
function TagGroup({ g, tags }: { g: { title: string; who: string; desc: string; scope: TagScope; stageId?: number; adm?: boolean }; tags: LibTag[] }) {
  const [name, setName] = useState('');
  const [tone, setTone] = useState<Tone>('neutral');
  const [renaming, setRenaming] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const add = useAction(() => api.post('/admin/tags', { scope: g.scope, name, tone, ...(g.stageId ? { stageId: g.stageId } : {}) }), {
    ok: `“${name}” added — the desks can use it now`,
    invalidate: inv,
  });
  const patch = useAction((a: { id: number; name?: string; tone?: Tone }) => api.patch(`/admin/tags/${a.id}`, { name: a.name, tone: a.tone }), { invalidate: inv });
  const del = useAction((id: number) => api.del(`/admin/tags/${id}`), { ok: 'Removed from the list', invalidate: inv });
  return (
    <div className="panel" style={{ marginBottom: 13 }}>
      <div className="panel__head">
        <h3>{g.title}</h3>
        <span className="count">
          {tags.length} · {g.who}
        </span>
      </div>
      <div className="panel__body">
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 6 }}>{g.desc}</div>
        {tags.map((t) => (
          <div key={t.id} className="tg-row">
            {renaming === t.id ? (
              <span style={{ display: 'flex', gap: 5 }}>
                <input className="set-ctl" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus style={{ width: 180 }} />
                <button className="btn btn-signal btn-sm" disabled={!newName.trim()} onClick={() => patch.mutate({ id: t.id, name: newName.trim() }, { onSuccess: () => setRenaming(null) })}>
                  Save
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span
                onClick={() => {
                  setRenaming(t.id);
                  setNewName(t.name);
                }}
                title="Rename"
                style={{ cursor: 'pointer' }}
              >
                <Pill tone={tonePill(t.tone)} adm={g.adm}>
                  {t.name}
                </Pill>
              </span>
            )}
            <span className="used">{t.used ? `${t.used} in use` : 'unused'}</span>
            <div className="tones">
              {TONES.map((tn) => (
                <button key={tn} className={t.tone === tn ? 'on' : ''} style={{ background: TONE_SWATCH[tn][0], borderColor: TONE_SWATCH[tn][1] }} title={tn} onClick={() => patch.mutate({ id: t.id, tone: tn })} />
              ))}
            </div>
            <button className="tg-del" title={t.used ? 'In use — removing keeps existing records' : 'Remove tag'} onClick={() => confirm(`Remove “${t.name}” from the list?`) && del.mutate(t.id)}>
              ✕
            </button>
          </div>
        ))}
        <div className="newrow">
          <input className="n" placeholder="New tag name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && add.mutate(undefined, { onSuccess: () => setName('') })} />
          <select className="sel" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
            {TONES.map((tn) => (
              <option key={tn} value={tn}>
                {tn}
              </option>
            ))}
          </select>
          <button className="btn btn-signal btn-sm" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => setName('') })}>
            Add tag
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- categories ------------------------------ */
function Categories({ lib }: { lib: Library }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const add = useAction(() => api.post('/admin/categories', { name }), { ok: `${name} added`, invalidate: inv });
  const rename = useAction(() => api.patch(`/admin/categories/${editing!.id}`, { name: editing!.name }), { ok: 'Renamed', invalidate: inv });
  const del = useAction((id: number) => api.del(`/admin/categories/${id}`), { ok: 'Removed', invalidate: inv });
  return (
    <div className="panel">
      <div className="panel__head">
        <h3>Product categories</h3>
        <span className="count">picked on each lead · Standard, Fancy, Sports…</span>
      </div>
      <div className="panel__body">
        {lib.categories.map((c) => (
          <div key={c.id} className="tg-row">
            {editing?.id === c.id ? (
              <span style={{ display: 'flex', gap: 5 }}>
                <input className="set-ctl" value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} autoFocus />
                <button className="btn btn-signal btn-sm" disabled={!editing.name.trim()} onClick={() => rename.mutate(undefined, { onSuccess: () => setEditing(null) })}>
                  Save
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span onClick={() => setEditing({ id: c.id, name: c.name })} style={{ cursor: 'pointer' }} title="Rename">
                <Pill>{c.name}</Pill>
              </span>
            )}
            <span className="used">{c.used ? `${c.used} leads` : 'unused'}</span>
            <span style={{ marginLeft: 'auto' }}></span>
            <button className="tg-del" title="Remove" onClick={() => confirm(`Remove “${c.name}”? Leads that have it keep it.`) && del.mutate(c.id)}>
              ✕
            </button>
          </div>
        ))}
        <div className="newrow">
          <input className="n" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-signal btn-sm" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => setName('') })}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- rules --------------------------------- */
function Rules({ lib }: { lib: Library }) {
  return (
    <div className="panel">
      <div className="panel__head">
        <h3>Rules &amp; alerts</h3>
        <span className="count">apply to every desk</span>
      </div>
      <div className="panel__body">
        {lib.settings.map((s) => (
          <RuleRow key={s.key} s={s} />
        ))}
        <div className="hint" style={{ marginTop: 10 }}>
          The discount limit applies now. The alert timings are used by the reminders and escalations in the next build.
        </div>
      </div>
    </div>
  );
}
function RuleRow({ s }: { s: Library['settings'][number] }) {
  const [v, setV] = useState(String(s.value));
  const save = useAction(() => api.put('/admin/settings', { key: s.key, value: Number(v) }), { ok: 'Saved', invalidate: inv });
  const changed = Number(v) !== s.value;
  return (
    <div className="tg-row" style={{ gap: 10 }}>
      <span style={{ flex: 1, fontSize: 13 }}>{s.label}</span>
      <input className="set-ctl" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 80, textAlign: 'right' }} />
      <button className="btn btn-signal btn-sm" disabled={!changed || v === '' || save.isPending} onClick={() => save.mutate(undefined)}>
        Save
      </button>
    </div>
  );
}

/* ------------------------------- templates ------------------------------- */
function Templates({ lib }: { lib: Library }) {
  const [edit, setEdit] = useState<Template | 'new' | null>(null);
  const del = useAction((id: number) => api.del(`/admin/templates/${id}`), { ok: 'Template removed', invalidate: inv });
  const groups: [Desk, 'client' | 'cre', string][] = [
    ['cre', 'client', 'CRE desk → client'],
    ['bd', 'client', 'BD desk → client'],
    ['bd', 'cre', 'BD desk → the CRE'],
  ];
  return (
    <>
      <div className="pipe-hint">
        <span>◆</span>Messages the desks can start from when they open WhatsApp. They can edit the text before sending. Placeholders: {'{contact}'} {'{client}'} {'{cre}'} {'{me}'}.
      </div>
      {groups.map(([desk, aud, title]) => {
        const rows = lib.templates.filter((t) => t.desk === desk && t.audience === aud);
        return (
          <div key={title} className="panel" style={{ marginBottom: 13 }}>
            <div className="panel__head">
              <h3>{title}</h3>
              <span className="count">{rows.length}</span>
            </div>
            <div className="panel__body">
              {rows.map((t) => (
                <div key={t.id} className="sd-row">
                  <div className="num">✉</div>
                  <div>
                    <div className="nm">{t.title}</div>
                    <div className="df">{t.body}</div>
                  </div>
                  <div className="ac">
                    <button className="btn btn-outline btn-sm" onClick={() => setEdit(t)}>
                      Edit
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => confirm(`Remove “${t.title}”?`) && del.mutate(t.id)}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {!rows.length && <div className="muted" style={{ fontSize: 12.5 }}>None yet.</div>}
            </div>
          </div>
        );
      })}
      <button className="btn btn-signal btn-sm" onClick={() => setEdit('new')}>
        + New template
      </button>
      {edit && <TemplateModal t={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}
function TemplateModal({ t, onClose }: { t: Template | null; onClose: () => void }) {
  const [f, setF] = useState({ desk: t?.desk ?? 'cre', audience: t?.audience ?? 'client', title: t?.title ?? '', body: t?.body ?? '' });
  const save = useAction(() => (t ? api.patch(`/admin/templates/${t.id}`, f) : api.post('/admin/templates', f)), { ok: 'Template saved', invalidate: inv });
  return (
    <Modal
      title={t ? `Edit “${t.title}”` : 'New WhatsApp template'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-signal" disabled={!f.title.trim() || !f.body.trim() || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Desk</label>
          <select value={f.desk} onChange={(e) => setF({ ...f, desk: e.target.value as Desk, audience: e.target.value === 'cre' ? 'client' : f.audience })}>
            <option value="cre">CRE desk</option>
            <option value="bd">BD desk</option>
          </select>
        </div>
        <div className="field">
          <label>Sent to</label>
          <select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as 'client' | 'cre' })} disabled={f.desk === 'cre'}>
            <option value="client">The client</option>
            <option value="cre">The CRE who handed over</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Title</label>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Visit confirmation" />
      </div>
      <div className="field">
        <label>Message</label>
        <textarea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Hello {contact}, …" />
      </div>
    </Modal>
  );
}

/* ------------------------------ lead sources ----------------------------- */
const MARK: Record<string, [string, string]> = {
  meta: ['M', 'blue'],
  google: ['G', 'red'],
  justdial: ['JD', 'amber'],
  indiamart: ['IM', 'green'],
  sulekha: ['S', 'violet'],
  website: ['W', 'blue'],
  walkin: ['+', 'amber'],
};
const SRC_DESC: Record<string, string> = {
  meta: 'Instant-form leads from Facebook & Instagram campaigns.',
  google: 'Lead-form extensions from Search & Display campaigns.',
  justdial: 'Enquiries pushed from your Justdial listing.',
  indiamart: 'Buy-leads from your IndiaMART catalog.',
  sulekha: 'Matched service leads from your Sulekha listing.',
  website: 'The enquiry form on the JK Racks website.',
  walkin: 'Added by hand with “+ Add lead”.',
};
function Sources() {
  return (
    <>
      <div className="pipe-hint">
        <span>◆</span>Automatic lead sources are connected in the next build. Until then, add leads from these platforms with “+ Add lead” and pick the platform — they're counted by source on the dashboard either way.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12 }}>
        {PLATFORMS.map((p) => {
          const [m, tone] = MARK[p]!;
          return (
            <div key={p} className={`int ${p === 'walkin' ? 'live' : ''}`}>
              <div className="int__top">
                <div className="int__mark" style={{ background: `color-mix(in srgb,var(--signal-${tone === 'amber' ? 'amber' : tone}) 18%,transparent)`, color: `var(--signal-${tone})` }}>
                  {m}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="int__n">{platformName(p)}</div>
                  <div className="int__d">{SRC_DESC[p]}</div>
                </div>
              </div>
              <div className="int__meta">
                {p === 'walkin' ? <span style={{ color: 'var(--signal-green)' }}>● Always on</span> : <span>Connection arrives in the lead-sources build</span>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

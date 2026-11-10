/** An Admin's own sticky notes on a record — edited in place, saved when you click away. */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NOTE_COLORS } from '@jkay/shared';
import { api } from '../../lib/api';
import { when } from '../../lib/format';
import { useToast } from '../../components/ui';
import { adminInvalidate, type AdminRecord } from './adminShared';

export function StickyNotes({ r, onClose }: { r: AdminRecord; onClose?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(r.notes.length ? null : '');
  const refresh = () => adminInvalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const base = `/leads/${r.id}/notes`;

  return (
    <div className="nbox">
      <div className="nbox__head">
        <span>Sticky notes · only you see these</span>
        {onClose && (
          <span className="cl" onClick={onClose}>
            Close ✕
          </span>
        )}
      </div>
      <div className="nstack">
        {draft !== null && (
          <div className="sticky" style={{ background: NOTE_COLORS[0] }}>
            <textarea
              autoFocus
              placeholder="Type the note…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft.trim()) run(api.post(base, { text: draft.trim(), color: NOTE_COLORS[0] })).then(() => setDraft(null));
                else if (r.notes.length) setDraft(null);
              }}
            />
            <div className="sticky__foot">
              <span>new · saves when you click away</span>
            </div>
          </div>
        )}
        {r.notes.map((n) => (
          <div key={n.id} className={`sticky ${n.pinned ? 'pinned' : ''}`} style={{ background: n.color }}>
            <textarea
              defaultValue={n.text}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (!v) run(api.del(`${base}/${n.id}`));
                else if (v !== n.text) run(api.patch(`${base}/${n.id}`, { text: v }));
              }}
            />
            <div className="sticky__foot">
              <span>{when(n.updatedAt)}</span>
              <span className="ac" onClick={() => run(api.patch(`${base}/${n.id}`, { pinned: !n.pinned }))}>
                {n.pinned ? 'Unpin' : 'Pin'}
              </span>
              <span className="ac" onClick={() => run(api.del(`${base}/${n.id}`))}>
                Delete
              </span>
              <span className="sw">
                {NOTE_COLORS.map((c) => (
                  <i key={c} className={c === n.color ? 'on' : ''} style={{ background: c }} onClick={() => run(api.patch(`${base}/${n.id}`, { color: c }))} />
                ))}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="nbox__foot">
        <button className="btn btn-outline btn-sm" onClick={() => setDraft('')} disabled={draft !== null}>
          + New note
        </button>
        <span className="hint">
          {r.notes.length} note{r.notes.length === 1 ? '' : 's'} · no CRE, BDE or other Admin sees them
        </span>
      </div>
    </div>
  );
}

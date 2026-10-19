import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { acceptFor, fileUrl, uploadFile } from '../lib/upload';
import type { LeadDetail } from '../lib/types';
import { useToast } from './ui';

/** Site photos on a lead. The CRE adds them; the BDE sees them after hand-off. */
export function Photos({ d, canAdd, title = 'Site photos', aux }: { d: LeadDetail; canAdd: boolean; title?: string; aux?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const refresh = () => qc.invalidateQueries({ queryKey: ['lead', d.lead.id] });

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    setBusy(list.length);
    let ok = 0;
    for (const f of list) {
      try {
        await uploadFile(d.lead.id, 'photo', f);
        ok++;
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`);
      }
      setBusy((n) => n - 1);
    }
    if (ok) toast(`${ok} photo${ok > 1 ? 's' : ''} added`);
    if (input.current) input.current.value = '';
    refresh();
  };
  const remove = async (id: number) => {
    try {
      await api.del(`/files/${id}`);
      toast('Photo removed');
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="d-sec">
      <div className="d-sec__head">
        <h4>{title}</h4>
        <span className="aux">{aux ?? `${d.photos.length} attached`}</span>
      </div>
      <div className="photos">
        {d.photos.map((p) => (
          <a key={p.id} className="photo has-img" href={fileUrl(p.id)} target="_blank" rel="noopener" title={`${p.fileName} · ${p.by}`}>
            <img src={fileUrl(p.id)} alt={p.fileName} loading="lazy" />
            {canAdd && p.mine && (
              <span
                className="photo__rm"
                title="Remove"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  remove(p.id);
                }}
              >
                ✕
              </span>
            )}
          </a>
        ))}
        {canAdd && (
          <button className="photo photo--add" onClick={() => input.current?.click()} disabled={busy > 0}>
            {busy ? `Uploading ${busy}…` : '+ Add photos'}
          </button>
        )}
        {!d.photos.length && !canAdd && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No site photos.</span>}
      </div>
      <input ref={input} type="file" accept={acceptFor('photo')} multiple capture={undefined} style={{ display: 'none' }} onChange={(e) => add(e.target.files)} />
    </div>
  );
}

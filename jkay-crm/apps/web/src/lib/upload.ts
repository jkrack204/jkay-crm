import { UPLOAD_ACCEPT, UPLOAD_MAX_BYTES, type AttachmentKind } from '@jkay/shared';
import { ApiError } from './api';

export type Uploaded = { id: number; kind: AttachmentKind; fileName: string; sizeBytes: number; createdAt: string };

export const acceptFor = (kind: AttachmentKind) => UPLOAD_ACCEPT[kind].join(',');

/**
 * Phone photos are often 4–8 MB. Shrink them to ~1600px JPEG in the browser before
 * upload — plenty for a site photo, and it keeps storage (and the bill) small.
 */
async function shrinkPhoto(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function uploadFile(leadId: string, kind: AttachmentKind, file: File): Promise<Uploaded> {
  const ext = ('.' + (file.name.split('.').pop() ?? '')).toLowerCase();
  if (!UPLOAD_ACCEPT[kind].includes(ext)) throw new ApiError(400, `Use one of: ${UPLOAD_ACCEPT[kind].join(', ')}`);
  const f = kind === 'photo' ? await shrinkPhoto(file) : file;
  if (f.size > UPLOAD_MAX_BYTES) throw new ApiError(400, `Files can be up to ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
  const body = new FormData();
  body.append('file', f, f.name);
  const res = await fetch(`/api/files?leadId=${encodeURIComponent(leadId)}&kind=${kind}`, { method: 'POST', body, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Upload failed (${res.status})`);
  return data.attachment as Uploaded;
}

/** Opens through the app, which checks access and hands over a short-lived link. */
export const fileUrl = (id: number, download = false) => `/api/files/${id}${download ? '?download=1' : ''}`;

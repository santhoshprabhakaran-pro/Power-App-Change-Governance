import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnnotationsService } from '../../generated';
import type { Annotations } from '../../generated/models/AnnotationsModel';
import { getDisplayTimezone } from '../../utils/format';

interface Props {
  objectId: string;
  /** Dataverse entity logical name for the parent record (e.g. 'cgmp_changes', 'cgmp_projects').
   *  Required for Annotations to associate correctly via objecttypecode. */
  objectTypeCode?: string;
  readOnly?: boolean;
  /** When set, uploads are tagged with this prefix in `subject` so files from different contexts
   *  (e.g. different projects within the same change) don't mix. */
  subjectPrefix?: string;
  /** Compact mode — no outer border/header padding, just the list + upload row */
  compact?: boolean;
}

function fmtSize(bytes: number | undefined | null): string {
  if (bytes == null) return '';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: getDisplayTimezone() });
}

function mimeIcon(mime: string | undefined): string {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📽️';
  if (mime.includes('zip') || mime.includes('compressed')) return '🗜️';
  return '📄';
}

/** Trigger a browser download from a base64 documentbody */
export function downloadAnnotation(a: Annotations) {
  if (!a.documentbody || !a.filename) return;
  try {
    const byteChars = atob(a.documentbody);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: a.mimetype || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = a.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch { /* no-op */ }
}

/** Load all annotations for a record, optionally filtered by subject prefix */
export async function loadAnnotations(objectId: string, subjectPrefix?: string): Promise<Annotations[]> {
  const r = await AnnotationsService.getAll({
    filter: `_objectid_value eq ${objectId} and isdocument eq true`,
    orderBy: ['createdon desc'],
    top: 200,
  });
  const all = (r.success && r.data) ? r.data : [];
  if (!subjectPrefix) return all;
  return all.filter(a => a.subject?.startsWith(subjectPrefix));
}

export default function AttachmentPanel({ objectId, objectTypeCode = 'cgmp_changes', readOnly = false, subjectPrefix, compact = false }: Props) {
  const [attachments, setAttachments] = useState<Annotations[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const groupedAttachments = useMemo(() => {
    const map = new Map<string, Annotations[]>();
    attachments.forEach(a => {
      const key = a.filename ?? a.annotationid;
      const existing = map.get(key) ?? [];
      map.set(key, [...existing, a].sort((x, y) => {
        const tx = x.createdon ? new Date(x.createdon).getTime() : 0;
        const ty = y.createdon ? new Date(y.createdon).getTime() : 0;
        return ty - tx;
      }));
    });
    return [...map.entries()];
  }, [attachments]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAttachments(await loadAnnotations(objectId, subjectPrefix)); }
    catch { /* shows empty state */ }
    finally { setLoading(false); }
  }, [objectId, subjectPrefix]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !objectId) return;
    setUploading(true);
    setError('');
    try {
      await new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const dataUrl = reader.result as string;
            const commaIdx = dataUrl.indexOf(',');
            const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
            if (!base64) throw new Error('Failed to read file data');
            const subjectTag = subjectPrefix ? `${subjectPrefix}${file.name}` : file.name;
            const r = await AnnotationsService.create({
              subject: subjectTag,
              filename: file.name,
              documentbody: base64,
              mimetype: file.type || 'application/octet-stream',
              isdocument: true,
              objectid: objectId,
              objecttypecode: objectTypeCode,
              filesize: file.size,
            } as any);
            if (!r.success) throw r.error ?? new Error('Upload failed');
            resolve();
          } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [objectId, objectTypeCode, subjectPrefix, load]);

  const handleDelete = useCallback(async (a: Annotations) => {
    if (!confirm(`Delete "${a.filename}"?`)) return;
    try {
      await AnnotationsService.delete(a.annotationid);
      setAttachments(prev => prev.filter(x => x.annotationid !== a.annotationid));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }, []);

  const title = `Attachments${!loading && groupedAttachments.length > 0 ? ` (${groupedAttachments.length})` : ''}`;

  if (compact) {
    return (
      <div className="attach-panel attach-panel--compact">
        {error && <div className="attach-panel__error">{error}</div>}
        {groupedAttachments.length > 0 && (
          <div className="attach-panel__list">
            {groupedAttachments.map(([filename, versions]) => {
              const a = versions[0];
              return (
                <div key={filename}>
                  <div className="attach-item attach-item--sm">
                    <span className="attach-item__icon">{mimeIcon(a.mimetype)}</span>
                    <span className="attach-item__name" style={{ flex: 1, fontSize: 12 }} title={a.filename}>
                      {a.filename}
                      {versions.length > 1 && (
                        <button className="attach-version-badge" onClick={() => setExpandedFiles(prev => {
                          const next = new Set(prev);
                          prev.has(filename) ? next.delete(filename) : next.add(filename);
                          return next;
                        })}>
                          {versions.length} versions {expandedFiles.has(filename) ? '▲' : '▼'}
                        </button>
                      )}
                    </span>
                    <div className="attach-item__actions">
                      <button className="attach-item__btn" title="Download" onClick={() => downloadAnnotation(a)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
                      </button>
                      {!readOnly && (
                        <button className="attach-item__btn attach-item__btn--danger" title="Delete" onClick={() => handleDelete(a)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {versions.length > 1 && expandedFiles.has(filename) && versions.slice(1).map(old => (
                    <div key={old.annotationid} className="attach-item attach-item--version">
                      <span className="attach-item__icon" style={{ opacity: 0.5 }}>{mimeIcon(old.mimetype)}</span>
                      <div className="attach-item__info">
                        <span className="attach-item__name" style={{ opacity: 0.7, fontSize: 11 }}>v{versions.indexOf(old) + 1} — {fmtDate(old.createdon)}</span>
                        <span className="attach-item__meta">{fmtSize(old.filesize)}{old.owneridname ? ` · ${old.owneridname}` : ''}</span>
                      </div>
                      <div className="attach-item__actions">
                        <button className="attach-item__btn" title="Download version" onClick={() => downloadAnnotation(old)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {!readOnly && (
          <div style={{ padding: '6px 0' }}>
            <button className="btn btn--sm btn--outline attach-panel__upload-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : (
                <><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" /></svg> Attach File</>
              )}
            </button>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="attach-panel">
      <div className="attach-panel__header">
        <span className="attach-panel__title">{title}</span>
        {!readOnly && (
          <>
            <button className="btn btn--sm btn--outline attach-panel__upload-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" /></svg> Upload File</>
              )}
            </button>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
          </>
        )}
      </div>

      {error && <div className="attach-panel__error">{error}</div>}

      {loading ? (
        <div className="attach-panel__empty">Loading…</div>
      ) : groupedAttachments.length === 0 ? (
        <div className="attach-panel__empty">
          {readOnly ? 'No files uploaded' : 'No attachments yet — upload files above'}
        </div>
      ) : (
        <div className="attach-panel__list">
          {groupedAttachments.map(([filename, versions]) => {
            const a = versions[0];
            return (
              <div key={filename}>
                <div className="attach-item">
                  <span className="attach-item__icon">{mimeIcon(a.mimetype)}</span>
                  <div className="attach-item__info">
                    <span className="attach-item__name" title={a.filename}>
                      {a.filename}
                      {versions.length > 1 && (
                        <button className="attach-version-badge" onClick={() => setExpandedFiles(prev => {
                          const next = new Set(prev);
                          prev.has(filename) ? next.delete(filename) : next.add(filename);
                          return next;
                        })}>
                          {versions.length} versions {expandedFiles.has(filename) ? '▲' : '▼'}
                        </button>
                      )}
                    </span>
                    <span className="attach-item__meta">
                      {fmtSize(a.filesize)}{a.filesize ? ' · ' : ''}{fmtDate(a.createdon)}
                      {a.owneridname ? ` · ${a.owneridname}` : ''}
                    </span>
                  </div>
                  <div className="attach-item__actions">
                    <button className="attach-item__btn" title="Download" onClick={() => downloadAnnotation(a)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
                    </button>
                    {!readOnly && (
                      <button className="attach-item__btn attach-item__btn--danger" title="Delete" onClick={() => handleDelete(a)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                      </button>
                    )}
                  </div>
                </div>
                {versions.length > 1 && expandedFiles.has(filename) && versions.slice(1).map(old => (
                  <div key={old.annotationid} className="attach-item attach-item--version">
                    <span className="attach-item__icon" style={{ opacity: 0.5 }}>{mimeIcon(old.mimetype)}</span>
                    <div className="attach-item__info">
                      <span className="attach-item__name" style={{ opacity: 0.7, fontSize: 11 }}>v{versions.indexOf(old) + 1} — {fmtDate(old.createdon)}</span>
                      <span className="attach-item__meta">{fmtSize(old.filesize)}{old.owneridname ? ` · ${old.owneridname}` : ''}</span>
                    </div>
                    <div className="attach-item__actions">
                      <button className="attach-item__btn" title="Download version" onClick={() => downloadAnnotation(old)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

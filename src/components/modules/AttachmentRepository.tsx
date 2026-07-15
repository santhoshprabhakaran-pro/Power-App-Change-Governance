import { useState, useEffect, useRef, useCallback } from 'react';
import { AnnotationsService } from '../../generated/services/AnnotationsService';
import type { Annotations } from '../../generated/models/AnnotationsModel';
import { useApp } from '../../context/AppContext';
import { fmtDateTime, getDisplayTimezone } from '../../utils/format';

interface CategoryDef {
  icon: string;
  label: string;
  desc: string;
  keywords: string[];
  color: string;
}

const MAX_FILE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

const CATEGORY_DEFS: CategoryDef[] = [
  {
    icon: '📋', label: 'SOP Documents', desc: 'Standard Operating Procedures',
    keywords: ['sop', 'standard operating', 'procedure'],
    color: 'var(--primary)',
  },
  {
    icon: '🌉', label: 'Bridge Plans', desc: 'Bridge execution and coordination plans',
    keywords: ['bridge', 'bridge plan', 'execution plan'],
    color: 'var(--purple)',
  },
  {
    icon: '↩', label: 'Rollback Plans', desc: 'Step-by-step rollback procedures',
    keywords: ['rollback', 'backout', 'revert'],
    color: 'var(--danger)',
  },
  {
    icon: '📄', label: 'PIR Documents', desc: 'Post Implementation Review documents',
    keywords: ['pir', 'post implementation', 'lessons learned', 'closure'],
    color: 'var(--success)',
  },
  {
    icon: '🏗', label: 'Architecture Diagrams', desc: 'Infrastructure and solution diagrams',
    keywords: ['architecture', 'diagram', 'topology', 'design'],
    color: 'var(--teal)',
  },
];

const OTHER_CAT: CategoryDef = {
  icon: '📁', label: 'Other Documents', desc: 'Miscellaneous attachments',
  keywords: [],
  color: 'var(--text-secondary)',
};

function categorize(ann: Annotations): string {
  const text = ((ann.subject ?? '') + ' ' + (ann.filename ?? '') + ' ' + (ann.notetext ?? '')).toLowerCase();
  for (const cat of CATEGORY_DEFS) {
    if (cat.keywords.some(kw => text.includes(kw))) return cat.label;
  }
  return OTHER_CAT.label;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mime?: string): string {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
  if (mime.includes('powerpoint') || mime.includes('presentation')) return '📑';
  if (mime.startsWith('video/')) return '🎥';
  if (mime.startsWith('audio/')) return '🔊';
  return '📄';
}

function extractTags(notetext: string | undefined): string[] {
  if (!notetext) return [];
  const m = notetext.match(/\nTags:\s*(.+)/);
  return m ? m[1].split(',').map(t => t.trim()).filter(Boolean) : [];
}

/* #109 File versioning helpers */
function extractVersionMeta(notetext: string | undefined): { versionOf: string | null; version: number } {
  if (!notetext) return { versionOf: null, version: 1 };
  const vOf = notetext.match(/\nVersionOf:\s*([^\n]+)/)?.[1]?.trim() ?? null;
  const vNum = Number(notetext.match(/\nVersion:\s*(\d+)/)?.[1] ?? '1');
  return { versionOf: vOf, version: isNaN(vNum) ? 1 : vNum };
}

function getRootId(ann: Annotations, allAnns: Annotations[]): string {
  /* Walk VersionOf chain to find root annotation id — depth-limited to prevent infinite loops */
  let current = ann;
  const visited = new Set<string>();
  let depth = 0;
  const MAX_DEPTH = 50;
  while (depth < MAX_DEPTH) {
    const meta = extractVersionMeta(current.notetext);
    if (!meta.versionOf || visited.has(meta.versionOf)) break;
    visited.add(meta.versionOf);
    const parent = allAnns.find(a => a.annotationid === meta.versionOf);
    if (!parent) break;
    current = parent;
    depth++;
  }
  return current.annotationid;
}

function getVersionChain(ann: Annotations, allAnns: Annotations[]): Annotations[] {
  /* Return all versions of the same file (same root), sorted ascending by version number */
  const rootId = getRootId(ann, allAnns);
  const chain = allAnns.filter(a => {
    if (a.annotationid === rootId) return true;
    const meta = extractVersionMeta(a.notetext);
    if (!meta.versionOf) return false;
    return getRootId(a, allAnns) === rootId;
  });
  chain.sort((a, b) => extractVersionMeta(a.notetext).version - extractVersionMeta(b.notetext).version);
  return chain;
}

interface UploadState {
  category: string;
  subject: string;
  tags: string;
  file: File | null;
  uploading: boolean;
  error: string;
  versionMode: 'new' | 'replace';
  replaceTargetId: string | null;
  replaceTargetVersion: number;
  duplicateMatches: Annotations[];
}

export default function AttachmentRepository() {
  const { showToast } = useApp();
  const [annotations, setAnnotations] = useState<Annotations[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewAnn, setViewAnn] = useState<Annotations | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const BLANK_UPLOAD: UploadState = { category: CATEGORY_DEFS[0].label, subject: '', tags: '', file: null, uploading: false, error: '', versionMode: 'new', replaceTargetId: null, replaceTargetVersion: 1, duplicateMatches: [] };
  const [upload, setUpload] = useState<UploadState>(BLANK_UPLOAD);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* SharePoint integration — enable via developer tools:
   * localStorage.setItem('cgmp-feature-flags', JSON.stringify({'sharepoint-integration': true}))
   * localStorage.setItem('cgmp-sharepoint-url', 'https://yourtenant.sharepoint.com/sites/yoursite/Shared Documents')
   * Teams URLs rendered in this component must be validated with isValidTeamsUrl() from src/components/pmo/options.ts
   * before being rendered as anchor elements. Invalid URLs should be shown as plain text with a warning icon. */
  const isSharePointEnabled: boolean = JSON.parse(localStorage.getItem('cgmp-feature-flags') ?? '{}')['sharepoint-integration'] === true;
  const sharePointBaseUrl: string | null = localStorage.getItem('cgmp-sharepoint-url');

  const loadAnnotations = useCallback(async () => {
    setLoading(true);
    try {
      // Exclude documentbody from list query — fetch binary only on download
      const result = await AnnotationsService.getAll({
        filter: 'isdocument eq true',
        orderBy: ['createdon desc'],
        select: ['annotationid', 'filename', 'filesize', 'mimetype', 'subject', 'notetext', 'isdocument', 'createdon', 'createdbyname', 'ownerid', 'objectid', 'objecttypecode'] as any,
      });
      setAnnotations(result.data ?? []);
    } catch {
      showToast('error', 'Failed to load attachments from Dataverse');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);

  // Group annotations by category
  const grouped = new Map<string, Annotations[]>();
  for (const ann of annotations) {
    const cat = categorize(ann);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(ann);
  }

  const allCats = [...CATEGORY_DEFS, OTHER_CAT].filter(
    c => search.trim()
      ? c.label.toLowerCase().includes(search.toLowerCase()) || c.desc.toLowerCase().includes(search.toLowerCase())
      : true
  );

  const catFiles = selectedCat ? (grouped.get(selectedCat) ?? []) : [];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_FILE_BYTES) {
      setUpload(u => ({ ...u, file: null, error: `File too large — maximum size is ${MAX_FILE_MB} MB. This file is ${formatSize(file.size)}.` }));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file) {
      /* #109 Detect existing files with same name in same category */
      const existing = annotations.filter(a =>
        (a.filename ?? '').toLowerCase() === file.name.toLowerCase() && categorize(a) === upload.category
      );
      if (existing.length > 0) {
        /* Find the latest version */
        const latest = existing.reduce((prev, curr) => {
          const pv = extractVersionMeta(prev.notetext).version;
          const cv = extractVersionMeta(curr.notetext).version;
          return cv > pv ? curr : prev;
        });
        const latestVersion = extractVersionMeta(latest.notetext).version;
        setUpload(u => ({ ...u, file, error: '', duplicateMatches: existing, versionMode: 'replace', replaceTargetId: latest.annotationid, replaceTargetVersion: latestVersion }));
        return;
      }
    }
    setUpload(u => ({ ...u, file, error: '', duplicateMatches: [], versionMode: 'new', replaceTargetId: null }));
  };

  const handleUpload = async () => {
    if (!upload.file) { setUpload(u => ({ ...u, error: 'Please select a file.' })); return; }
    if (!upload.subject.trim()) { setUpload(u => ({ ...u, error: 'Please enter a subject/title.' })); return; }
    setUpload(u => ({ ...u, uploading: true, error: '' }));
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => { resolve((reader.result as string).split(',')[1] ?? ''); };
        reader.onerror = reject;
        reader.readAsDataURL(upload.file!);
      });

      const isVersionUpload = upload.versionMode === 'replace' && upload.replaceTargetId;
      const newVersion = isVersionUpload ? upload.replaceTargetVersion + 1 : 1;
      let notetext = `Category: ${upload.category}`;
      if (upload.tags.trim()) notetext += `\nTags: ${upload.tags.trim()}`;
      if (isVersionUpload) notetext += `\nVersionOf: ${upload.replaceTargetId}\nVersion: ${newVersion}`;

      const uploadResult = await AnnotationsService.create({
        subject: upload.subject.trim(),
        filename: upload.file.name,
        filesize: upload.file.size,
        mimetype: upload.file.type || 'application/octet-stream',
        documentbody: base64,
        isdocument: true,
        notetext,
      } as any);
      if (!uploadResult.success) throw uploadResult.error ?? new Error('Upload rejected by Dataverse');

      showToast('success', isVersionUpload ? `"${upload.file.name}" uploaded as version ${newVersion}` : `"${upload.file.name}" uploaded successfully`);
      setShowUpload(false);
      setUpload(BLANK_UPLOAD);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadAnnotations();
    } catch {
      setUpload(u => ({ ...u, error: 'Upload failed. Please try again.', uploading: false }));
    }
  };

  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (ann: Annotations) => {
    if (downloading) return;
    setDownloading(ann.annotationid);
    try {
      // Fetch documentbody on demand (excluded from list query)
      const result = await AnnotationsService.get(ann.annotationid, { select: ['documentbody', 'mimetype', 'filename'] as any });
      const body = result.data?.documentbody;
      if (!body) { showToast('error', 'No file content available'); return; }
      const link = document.createElement('a');
      link.href = `data:${ann.mimetype ?? 'application/octet-stream'};base64,${body}`;
      link.download = ann.filename ?? 'download';
      link.click();
    } catch { showToast('error', 'Download failed'); }
    finally { setDownloading(null); }
  };

  const handleDownloadAll = async (files: Annotations[]) => {
    if (downloading) return;
    if (files.length === 0) { showToast('info', 'No files in this category'); return; }
    setDownloading('all');
    try {
      for (let i = 0; i < files.length; i++) {
        const ann = files[i];
        const result = await AnnotationsService.get(ann.annotationid, { select: ['documentbody', 'mimetype', 'filename'] as any });
        const body = result.data?.documentbody;
        if (!body) continue;
        const link = document.createElement('a');
        link.href = `data:${ann.mimetype ?? 'application/octet-stream'};base64,${body}`;
        link.download = ann.filename ?? `file-${i + 1}`;
        link.click();
        if (i < files.length - 1) await new Promise(r => setTimeout(r, 600));
      }
      showToast('success', `Downloaded ${files.length} file${files.length !== 1 ? 's' : ''}…`);
    } catch { showToast('error', 'Download failed'); }
    finally { setDownloading(null); }
  };

  const handleDelete = async (ann: Annotations) => {
    if (!confirm(`Delete "${ann.filename ?? ann.subject}"?`)) return;
    try {
      await AnnotationsService.delete(ann.annotationid);
      showToast('success', 'Attachment deleted');
      setAnnotations(prev => prev.filter(a => a.annotationid !== ann.annotationid));
      if (viewAnn?.annotationid === ann.annotationid) setViewAnn(null);
    } catch {
      showToast('error', 'Failed to delete attachment');
    }
  };

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Attachment Repository</h1>
          <p className="module-subtitle">Version-controlled SOPs, bridge plans, rollback plans, PIR documents, and architecture diagrams</p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setShowUpload(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}>
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
          </svg>
          Upload File
        </button>
      </div>

      <div className="attach-info-banner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <span>Attachments are stored in Dataverse Notes and version-controlled. Each document is linked to its change, project, or bridge record. Total: <strong>{annotations.length}</strong> documents.</span>
      </div>

      <div className="filter-bar" style={{ margin: '0 24px 16px' }}>
        <input
          className="filter-bar__search"
          placeholder="Search document categories…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="btn btn--secondary btn--sm" onClick={loadAnnotations} style={{ marginLeft: 8 }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div className="attach-loading">
          <div className="loading-spinner" />
          <span>Loading attachments from Dataverse…</span>
        </div>
      ) : (
        <div className="attach-category-grid">
          {allCats.map(cat => {
            const files = grouped.get(cat.label) ?? [];
            const isSelected = selectedCat === cat.label;
            return (
              <div
                key={cat.label}
                className={`attach-category-card ${isSelected ? 'attach-category-card--selected' : ''}`}
                onClick={() => setSelectedCat(isSelected ? null : cat.label)}
                style={{ borderTop: `3px solid ${cat.color}` }}
              >
                <div className="attach-category-icon" style={{ color: cat.color }} aria-hidden="true">{cat.icon}</div>
                <div className="attach-category-label">{cat.label}</div>
                <div className="attach-category-desc">{cat.desc}</div>
                <div className="attach-category-count">
                  <span style={{ color: cat.color, fontWeight: 700, fontSize: 20 }}>{files.length}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 4 }}>documents</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Expanded file list panel */}
      {selectedCat && !loading && (
        <div className="attach-expanded">
          <div className="attach-expanded__header">
            <span aria-hidden="true" className="attach-expanded__icon" style={{ color: [...CATEGORY_DEFS, OTHER_CAT].find(c => c.label === selectedCat)?.color }}>
              {[...CATEGORY_DEFS, OTHER_CAT].find(c => c.label === selectedCat)?.icon}
            </span>
            <div>
              <h3 className="attach-expanded__title">{selectedCat}</h3>
              <p className="attach-expanded__desc">{catFiles.length} document{catFiles.length !== 1 ? 's' : ''}</p>
            </div>
            {catFiles.length > 0 && (
              <button
                className="btn btn--outline btn--sm"
                onClick={() => handleDownloadAll(catFiles)}
                title={`Download all ${catFiles.length} files in this category`}
                style={{ marginLeft: 'auto', marginRight: 8 }}
              >
                ⬇ Download All ({catFiles.length})
              </button>
            )}
            <button className="slide-panel__close" onClick={() => setSelectedCat(null)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
          <div className="attach-expanded__body">
            {catFiles.length === 0 ? (
              <div className="attach-empty-state">
                <div className="attach-empty-icon" aria-hidden="true">{[...CATEGORY_DEFS, OTHER_CAT].find(c => c.label === selectedCat)?.icon}</div>
                <div className="attach-empty-title">No {selectedCat} yet</div>
                <p className="attach-empty-msg">Upload a file and set the subject to include a keyword like "{CATEGORY_DEFS.find(c => c.label === selectedCat)?.keywords[0] ?? selectedCat.toLowerCase()}" so it appears in this category.</p>
                <button className="btn btn--primary btn--sm" style={{ marginTop: 16 }} onClick={() => { setUpload(u => ({ ...u, category: selectedCat })); setShowUpload(true); }}>
                  Upload File
                </button>
              </div>
            ) : (
              <div className="attach-file-list">
                {catFiles.map(ann => {
                  const tags = extractTags(ann.notetext);
                  return (
                    <div key={ann.annotationid} className="attach-file-row" role="button" tabIndex={0} onClick={() => setViewAnn(ann)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewAnn(ann); } }}>
                      <span className="attach-file-mime" aria-hidden="true">{mimeIcon(ann.mimetype)}</span>
                      <div className="attach-file-info">
                        <div className="attach-file-name">{ann.filename ?? ann.subject ?? 'Unnamed'}</div>
                        <div className="attach-file-meta">
                          {ann.owneridname && <span>{ann.owneridname}</span>}
                          {ann.createdon && <span>{new Date(ann.createdon).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() })}</span>}
                          {ann.filesize && <span>{formatSize(ann.filesize)}</span>}
                        </div>
                        {tags.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {tags.map(t => (
                              <span key={t} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: 'var(--primary-light)', color: 'var(--primary)' }}>{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="attach-file-actions" onClick={e => e.stopPropagation()}>
                        <button className="btn btn--secondary btn--xs" onClick={() => handleDownload(ann)}>⬇ Download</button>
                        <button className="btn btn--danger btn--xs" onClick={() => handleDelete(ann)}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SharePoint Library Integration — visible when sharepoint-integration feature flag is enabled */}
      {isSharePointEnabled && (
        <div style={{ margin: '16px 24px 0', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: 'var(--surface-alt)', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }} aria-hidden="true">🔗</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>SharePoint Library</span>
            </div>
            <button
              className="btn btn--ghost btn--xs"
              style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
              onClick={() => showToast('info', 'Configure SharePoint URL in Settings → Integrations')}
              title="Configure SharePoint URL"
            >
              Configure SharePoint URL
            </button>
          </div>
          <div style={{ padding: '16px' }}>
            {!sharePointBaseUrl ? (
              <div className="attach-empty-state" style={{ padding: '24px 0' }}>
                <div className="attach-empty-icon" aria-hidden="true">🔗</div>
                <div className="attach-empty-title">SharePoint site not configured</div>
                <p className="attach-empty-msg">
                  Configure the SharePoint site URL in{' '}
                  <button
                    className="audit-entity-link"
                    onClick={() => showToast('info', 'Configure SharePoint URL in Settings → Integrations')}
                  >
                    Settings
                  </button>
                  {' '}to connect your document library.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <a
                    href={sharePointBaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--primary btn--sm"
                  >
                    Open Document Library
                  </a>
                  <button
                    className="btn btn--secondary btn--sm"
                    onClick={() => window.open(`${sharePointBaseUrl}/_layouts/15/upload.aspx`, '_blank', 'noopener,noreferrer')}
                  >
                    Upload to SharePoint
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', wordBreak: 'break-all' }}>
                    {sharePointBaseUrl}
                  </span>
                </div>
                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>SharePoint Files</div>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
                    SharePoint file listing requires the SharePoint connector configured in Settings → SharePoint Integration.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* File detail viewer */}
      {viewAnn && (
        <div className="module-detail-overlay" role="button" tabIndex={0} aria-label="Close" onClick={() => setViewAnn(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewAnn(null); } }}>
          <div className="module-detail-panel" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="module-detail-header">
              <h2 className="module-detail-title">{viewAnn.filename ?? viewAnn.subject ?? 'Document'}</h2>
              <button className="slide-panel__close" onClick={() => setViewAnn(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
            <div className="module-detail-body">
              <div className="detail-section">
                <div className="detail-field"><span className="detail-label">File Name</span><span>{viewAnn.filename ?? '—'}</span></div>
                <div className="detail-field"><span className="detail-label">Subject</span><span>{viewAnn.subject ?? '—'}</span></div>
                <div className="detail-field"><span className="detail-label">MIME Type</span><span>{viewAnn.mimetype ?? '—'}</span></div>
                <div className="detail-field"><span className="detail-label">Size</span><span>{formatSize(viewAnn.filesize) || '—'}</span></div>
                <div className="detail-field"><span className="detail-label">Uploaded By</span><span>{viewAnn.owneridname ?? '—'}</span></div>
                <div className="detail-field"><span className="detail-label">Created On</span><span>{fmtDateTime(viewAnn.createdon)}</span></div>
                {viewAnn.notetext && <div className="detail-field"><span className="detail-label">Notes</span><span>{viewAnn.notetext}</span></div>}
                {viewAnn.objecttypecode && <div className="detail-field"><span className="detail-label">Linked Entity</span><span>{viewAnn.objecttypecode}</span></div>}
              </div>
              {viewAnn.mimetype?.startsWith('image/') && viewAnn.documentbody && (
                <img
                  src={`data:${viewAnn.mimetype};base64,${viewAnn.documentbody}`}
                  alt={viewAnn.filename}
                  style={{ maxWidth: '100%', borderRadius: 6, marginTop: 12 }}
                />
              )}
              {/* #109 Version history */}
              {(() => {
                const chain = getVersionChain(viewAnn, annotations);
                if (chain.length <= 1) return null;
                return (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Version History ({chain.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {chain.map(v => {
                        const isCurrent = v.annotationid === viewAnn.annotationid;
                        const vm = extractVersionMeta(v.notetext);
                        return (
                          <div key={v.annotationid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: isCurrent ? 'var(--primary-pale)' : 'transparent', fontSize: 12 }}>
                            <span style={{ fontWeight: 700, color: 'var(--primary)', minWidth: 32 }}>v{vm.version}</span>
                            <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{v.owneridname ?? '—'} · {v.createdon ? new Date(v.createdon).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() }) : '—'}</span>
                            {isCurrent && <span style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 600 }}>Current</span>}
                            {!isCurrent && (
                              <button className="btn btn--xs btn--outline" onClick={() => { setViewAnn(v); }}>View</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                <button className="btn btn--primary" onClick={() => handleDownload(viewAnn)}>⬇ Download</button>
                <button className="btn btn--danger" onClick={() => { handleDelete(viewAnn); setViewAnn(null); }}>Delete</button>
                {sharePointBaseUrl && (
                  <>
                    {/* Copy SharePoint Link — requires a pre-configured SharePoint folder structure.
                        This link uses the parent record's Dataverse objectid as the folder name.
                        For change-number-based paths, fetch the parent cgmp_changes record first
                        to obtain cgmp_changenumber and substitute it for viewAnn.objectid. */}
                    <button
                      className="btn btn--outline"
                      title="Copy SharePoint link to clipboard"
                      onClick={() => {
                        const spLink = `${sharePointBaseUrl ?? ''}/${viewAnn.objectid ?? 'unknown'}/${viewAnn.filename ?? ''}`;
                        navigator.clipboard.writeText(spLink)
                          .then(() => showToast('success', 'SharePoint link copied to clipboard'))
                          .catch(() => showToast('error', 'Failed to copy link'));
                      }}
                    >
                      Copy SharePoint Link
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload dialog */}
      {showUpload && (
        <div className="module-detail-overlay" role="button" tabIndex={0} aria-label="Close" onClick={() => !upload.uploading && setShowUpload(false)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!upload.uploading) setShowUpload(false); } }}>
          <div className="module-detail-panel" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="module-detail-header">
              <h2 className="module-detail-title">Upload Document</h2>
              <button className="slide-panel__close" onClick={() => !upload.uploading && setShowUpload(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
            <div className="module-detail-body">
              <div className="form-field">
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={upload.category}
                  onChange={e => setUpload(u => ({ ...u, category: e.target.value }))}
                >
                  {[...CATEGORY_DEFS, OTHER_CAT].map(c => (
                    <option key={c.label} value={c.label}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Subject / Title <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input
                  className="form-input"
                  placeholder={`e.g. Network Change SOP v2.1`}
                  value={upload.subject}
                  onChange={e => setUpload(u => ({ ...u, subject: e.target.value }))}
                />
                <span className="form-hint">Include a keyword like "{CATEGORY_DEFS.find(c => c.label === upload.category)?.keywords[0] ?? 'document'}" so it is auto-categorized correctly.</span>
              </div>
              <div className="form-field">
                <label className="form-label">Tags (optional)</label>
                <input
                  className="form-input"
                  placeholder="e.g. PIDB-0001, CHG-2026-001, APAC"
                  value={upload.tags}
                  onChange={e => setUpload(u => ({ ...u, tags: e.target.value }))}
                />
                <span className="form-hint" style={{ color: 'var(--text-tertiary)' }}>Comma-separated project IDs, change numbers, or any relevant tags.</span>
              </div>
              <div className="form-field">
                <label className="form-label">File <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="form-input"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.txt,.csv,.zip"
                />
                <span className="form-hint" style={{ color: 'var(--text-tertiary)' }}>Max file size: {MAX_FILE_MB} MB · PDF, Office docs, images, CSV, ZIP</span>
                {upload.file && (
                  <span className="form-hint">{upload.file.name} ({formatSize(upload.file.size)})</span>
                )}
              </div>
              {/* #109 Version mode selector — shown when a duplicate is detected */}
              {upload.duplicateMatches.length > 0 && (
                <div style={{ background: 'var(--warning-light, #fff8e6)', border: '1px solid var(--warning)', borderRadius: 'var(--radius)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)' }}>
                    ⚠ A file with this name already exists in this category ({upload.duplicateMatches.length} version{upload.duplicateMatches.length > 1 ? 's' : ''})
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="radio" name="versionMode" checked={upload.versionMode === 'replace'} onChange={() => setUpload(u => ({ ...u, versionMode: 'replace' }))} />
                    <span><strong>Upload as new version</strong> — v{upload.replaceTargetVersion + 1} (links to current)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="radio" name="versionMode" checked={upload.versionMode === 'new'} onChange={() => setUpload(u => ({ ...u, versionMode: 'new' }))} />
                    <span>Upload as a separate file (independent)</span>
                  </label>
                </div>
              )}
              {upload.error && (
                <div className="attach-upload-error">{upload.error}</div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
                <button className="btn btn--secondary" onClick={() => !upload.uploading && setShowUpload(false)} disabled={upload.uploading}>
                  Cancel
                </button>
                <button className="btn btn--primary" onClick={handleUpload} disabled={upload.uploading}>
                  {upload.uploading ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Cre09_knowledgebasearticlesService, AnnotationsService } from '../../generated';
import type { Cre09_knowledgebasearticles } from '../../generated/models/Cre09_knowledgebasearticlesModel';
import type { Cre09_knowledgebasearticlesBase } from '../../generated/models/Cre09_knowledgebasearticlesModel';
import type { Cre09_knowledgebasearticlescre09_cgmp_category } from '../../generated/models/Cre09_knowledgebasearticlesModel';
import type { Annotations } from '../../generated/models/AnnotationsModel';
import { useApp } from '../../context/AppContext';
import { fmtDateTime, fmtDateTimeShort } from '../../utils/format';
import { SlidePanel, Dialog } from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';

const CAT_LABEL: Record<number, string> = {
  100000000: 'SOP', 100000001: 'FAQ', 100000002: 'Troubleshooting',
  100000003: 'Runbook', 100000004: 'Lessons Learned',
};
const CAT_CLASS: Record<number, string> = {
  100000000: 'status-released', 100000001: 'status-review', 100000002: 'status-uat',
  100000003: 'status-published', 100000004: 'status-inprogress',
};
const CAT_OPTS = Object.entries(CAT_LABEL).map(([v, l]) => ({ value: v, label: l }));

type ArticleForm = {
  title: string; category: string; content: string; tags: string;
  authorname: string; ispublished: boolean; relatedchangeid: string; relatedbridgeid: string;
};
const EMPTY_FORM: ArticleForm = { title: '', category: '100000000', content: '', tags: '', authorname: '', ispublished: false, relatedchangeid: '', relatedbridgeid: '' };

// ── Feature 9.1: Markdown toolbar helper (module-level) ──────────────────────
function insertMarkdown(ref: React.RefObject<HTMLTextAreaElement | null>, before: string, after = '', placeholder = 'text') {
  const el = ref.current; if (!el) return;
  const start = el.selectionStart; const end = el.selectionEnd;
  const selected = el.value.slice(start, end) || placeholder;
  const newText = el.value.slice(0, start) + before + selected + after + el.value.slice(end);
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  nativeInputValueSetter?.call(el, newText);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  el.setSelectionRange(start + before.length, start + before.length + selected.length);
}

// ── Feature 9.4: Review date helpers (module-level) ──────────────────────────
function extractReviewDate(tags: string | undefined): string | null {
  if (!tags) return null;
  const m = tags.match(/review:(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
function isStale(tags: string | undefined): boolean {
  const d = extractReviewDate(tags);
  if (!d) return false;
  return new Date(d) < new Date();
}
function injectReviewTag(tags: string, reviewDate: string): string {
  const cleaned = tags.split(',').map(t => t.trim()).filter(t => !t.startsWith('review:')).join(', ');
  if (!reviewDate) return cleaned;
  return cleaned ? `${cleaned}, review:${reviewDate}` : `review:${reviewDate}`;
}

/* #81 — Syntax highlighting tokens applied to fenced code blocks */
const CODE_KW: Record<string, RegExp> = {
  kw: /\b(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|new|await|async|try|catch|throw|typeof|instanceof|void|null|undefined|true|false|default|switch|case|break|continue|interface|type|enum|in|of|do|delete|this|super|static|abstract|readonly|public|private|protected|override|implements|declare|namespace|module)\b/g,
  str: /(["'`])(?:\\.|(?!\1)[^\\])*\1/g,
  comment: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g,
  num: /\b(\d+(?:\.\d+)?)\b/g,
  fn: /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*(?=\()/g,
};

function highlightCode(code: string, lang: string): string {
  if (!lang || lang === 'text' || lang === 'plain') return code;
  // Tokenize greedily to avoid overlapping: extract strings and comments first
  type Token = { type: string; val: string };
  const tokens: Token[] = [];
  const PLACEHOLDER = '';
  let work = code;
  // Comments
  work = work.replace(CODE_KW.comment, m => { tokens.push({ type: 'comment', val: m }); return PLACEHOLDER + (tokens.length - 1) + PLACEHOLDER; });
  // Strings
  CODE_KW.str.lastIndex = 0;
  work = work.replace(CODE_KW.str, m => { tokens.push({ type: 'str', val: m }); return PLACEHOLDER + (tokens.length - 1) + PLACEHOLDER; });
  // Numbers
  work = work.replace(CODE_KW.num, (_, n) => `<span class="ch-num">${n}</span>`);
  // Function names
  work = work.replace(CODE_KW.fn, (_, n) => `<span class="ch-fn">${n}</span>`);
  // Keywords
  CODE_KW.kw.lastIndex = 0;
  work = work.replace(CODE_KW.kw, m => `<span class="ch-kw">${m}</span>`);
  // Restore tokens
  work = work.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_, idx) => {
    const t = tokens[Number(idx)];
    return t.type === 'comment'
      ? `<span class="ch-comment">${t.val}</span>`
      : `<span class="ch-str">${t.val}</span>`;
  });
  return work;
}

function sanitizeHtml(html: string): string {
  // Remove script tags and event handlers
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/data\s*:/gi, 'blocked-data:')
    .replace(/<iframe\b[^>]*>/gi, '')
    .replace(/<object\b[^>]*>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '');
}

function renderMarkdown(md: string): string {
  // Step 1: Extract fenced code blocks before HTML encoding (placeholders are ASCII-safe)
  const codeBlocks: string[] = [];
  const mdStripped = md.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_, lang: string, code: string) => {
    const safeLang = lang.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trimEnd();
    const highlighted = highlightCode(escaped, lang.toLowerCase());
    const cls = safeLang ? ` data-lang="${safeLang}"` : '';
    codeBlocks.push(`<pre class="kb-code-block"${cls}>${safeLang ? `<span class="kb-code-lang">${safeLang}</span>` : ''}<code>${highlighted}</code></pre>`);
    return `CGMPCODEBLOCK${codeBlocks.length - 1}END`;
  });

  let html = mdStripped
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') // HTML-encode remaining content
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, text, url) => {
      const safeUrl = url.replace(/"/g, '%22').replace(/'/g, '%27');
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
  // Convert bullet lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Convert numbered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  // Convert paragraphs — skip code block placeholders and already-tagged lines
  html = html.replace(/^(?!<[hul]|<li|<hr|CGMPCODEBLOCK)(.+)$/gm, '<p>$1</p>');
  // Re-insert code blocks
  codeBlocks.forEach((block, i) => { html = html.replace(`CGMPCODEBLOCK${i}END`, block); });
  return html;
}

export default function KnowledgeBase() {
  const { showToast, isAdmin, userProfile } = useApp();
  const isPMO = Number(userProfile?.cgmp_role) === 100000001;
  const canManageKB = isAdmin || isPMO;
  const [articles, setArticles] = useState<Cre09_knowledgebasearticles[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [publishedFilter, setPublishedFilter] = useState('true');
  const [kbTab, setKbTab] = useState<'articles' | 'review-queue'>('articles');
  const [readingArticle, setReadingArticle] = useState<Cre09_knowledgebasearticles | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editArticle, setEditArticle] = useState<Cre09_knowledgebasearticles | null>(null);
  const [form, setForm] = useState<ArticleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Cre09_knowledgebasearticles | null>(null);
  const lastViewedRef = useRef<string | null>(null);
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);
  /* #77 Comments & #80 Version History */
  const [kbAnnotations, setKbAnnotations] = useState<Annotations[]>([]);
  const [annLoading, setAnnLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);

  // Feature 9.1: textarea ref for markdown toolbar
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Feature 9.2: rating state
  const [localRating, setLocalRating] = useState<'up' | 'down' | null>(null);

  // Feature 9.4: review date state
  const [reviewDate, setReviewDate] = useState('');

  const loadArticles = useCallback(async () => {
    setLoading(true);
    try {
      const r = await Cre09_knowledgebasearticlesService.getAll({
        orderBy: ['modifiedon desc'],
        top: 500,
      });
      setArticles(r.data ?? []);
    } catch { setArticles([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadArticles(); }, [loadArticles]);

  // Feature 9.2: load rating when readingArticle changes
  useEffect(() => {
    if (!readingArticle) return;
    const saved = localStorage.getItem(`kb-rating-${readingArticle.cre09_knowledgebasearticleid}`);
    setLocalRating(saved === 'up' || saved === 'down' ? saved : null);
  }, [readingArticle]);

  // #77 Comments & #80 Version History: load annotations for current article
  useEffect(() => {
    if (!readingArticle) { setKbAnnotations([]); return; }
    let cancelled = false;
    setAnnLoading(true);
    AnnotationsService.getAll({
      filter: `_objectid_value eq ${readingArticle.cre09_knowledgebasearticleid} and isdocument eq false`,
      orderBy: ['createdon asc'],
      top: 200,
    }).then(r => {
      if (!cancelled) setKbAnnotations(r.data ?? []);
    }).catch(() => {
      if (!cancelled) setKbAnnotations([]);
    }).finally(() => { if (!cancelled) setAnnLoading(false); });
    return () => { cancelled = true; };
  }, [readingArticle]);

  const addKbComment = useCallback(async () => {
    if (!readingArticle || !newComment.trim()) return;
    setAddingComment(true);
    try {
      await AnnotationsService.create({
        subject: 'KB Comment',
        notetext: newComment.trim(),
        isdocument: false,
        objecttypecode: 'cre09_knowledgebasearticles' as any,
        'ObjectId@odata.bind': `/cre09_knowledgebasearticless(${readingArticle.cre09_knowledgebasearticleid})`,
        ownerid: '', owneridtype: '',
      } as any);
      setNewComment('');
      // Reload annotations
      const r = await AnnotationsService.getAll({
        filter: `_objectid_value eq ${readingArticle.cre09_knowledgebasearticleid} and isdocument eq false`,
        orderBy: ['createdon asc'],
        top: 200,
      });
      setKbAnnotations(r.data ?? []);
    } catch { /* best-effort */ }
    finally { setAddingComment(false); }
  }, [readingArticle, newComment]);

  // Related articles: published articles sharing at least one tag with the currently reading article
  const relatedArticles = useMemo(() => {
    if (!readingArticle) return [];
    const myTags = new Set(
      (readingArticle.cre09_cgmp_tags ?? '').split(',').map(t => t.trim().toLowerCase()).filter(t => t && !t.startsWith('review:'))
    );
    if (myTags.size === 0) return [];
    return articles
      .filter(a =>
        a.cre09_knowledgebasearticleid !== readingArticle.cre09_knowledgebasearticleid &&
        a.cre09_cgmp_ispublished &&
        (a.cre09_cgmp_tags ?? '').split(',').some(t => myTags.has(t.trim().toLowerCase()))
      )
      .slice(0, 4);
  }, [readingArticle, articles]);

  // Feature 9.2: rate article handler
  const rateArticle = (a: Cre09_knowledgebasearticles | null, rating: 'up' | 'down') => {
    if (!a) return;
    const key = `kb-rating-${a.cre09_knowledgebasearticleid}`;
    const current = localStorage.getItem(key);
    const newVal = current === rating ? null : rating; // toggle
    if (newVal) localStorage.setItem(key, newVal); else localStorage.removeItem(key);
    setLocalRating(newVal);
  };

  const filtered = useMemo(() => {
    let list = articles;
    if (publishedFilter === 'true') list = list.filter(a => a.cre09_cgmp_ispublished);
    else if (publishedFilter === 'false') list = list.filter(a => !a.cre09_cgmp_ispublished);
    if (catFilter) list = list.filter(a => (a.cre09_cgmp_category as unknown as number) === parseInt(catFilter));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.cre09_cgmp_title?.toLowerCase().includes(q) ||
        a.cre09_cgmp_tags?.toLowerCase().includes(q) ||
        a.cre09_cgmp_content?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [articles, publishedFilter, catFilter, search]);

  /* Review queue: articles with past review dates, sorted by staleness */
  const reviewQueue = useMemo(() => {
    return articles
      .filter(a => isStale(a.cre09_cgmp_tags))
      .map(a => {
        const dateStr = extractReviewDate(a.cre09_cgmp_tags);
        const daysOverdue = dateStr
          ? Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
          : 0;
        return { article: a, daysOverdue };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [articles]);

  /* Group by category */
  const grouped = useMemo(() => {
    const map = new Map<number, Cre09_knowledgebasearticles[]>();
    filtered.forEach(a => {
      const cat = a.cre09_cgmp_category as unknown as number;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(a);
    });
    return map;
  }, [filtered]);

  const openRead = useCallback((article: Cre09_knowledgebasearticles) => {
    setReadingArticle(article);
    /* Increment view count — only if this is a different article from the last opened one */
    if (lastViewedRef.current !== article.cre09_knowledgebasearticleid) {
      lastViewedRef.current = article.cre09_knowledgebasearticleid ?? null;
      Cre09_knowledgebasearticlesService.update(article.cre09_knowledgebasearticleid, {
        cre09_cgmp_viewcount: (article.cre09_cgmp_viewcount ?? 0) + 1,
      }).catch(err => { if (import.meta.env.DEV) console.error('View count update failed:', err); });
    }
  }, []);

  const openCreate = () => {
    if (!canManageKB) { showToast('error', 'Only Admins and PMO members can create articles'); return; }
    setEditArticle(null);
    setForm(EMPTY_FORM);
    setReviewDate('');
    setPreview(false);
    setFormOpen(true);
  };

  const openEdit = (a: Cre09_knowledgebasearticles) => {
    if (!canManageKB) { showToast('error', 'Only Admins and PMO members can edit articles'); return; }
    setEditArticle(a);
    setForm({
      title: a.cre09_cgmp_title ?? '',
      category: String(a.cre09_cgmp_category as unknown as number),
      content: a.cre09_cgmp_content ?? '',
      tags: a.cre09_cgmp_tags ?? '',
      authorname: a.cre09_cgmp_authorname ?? '',
      ispublished: a.cre09_cgmp_ispublished ?? false,
      relatedchangeid: a.cre09_cgmp_relatedchangeid ?? '',
      relatedbridgeid: a.cre09_cgmp_relatedbridgeid ?? '',
    });
    // Feature 9.4: extract review date from tags
    setReviewDate(extractReviewDate(a.cre09_cgmp_tags) ?? '');
    setPreview(false);
    setFormOpen(true);
  };

  const setField = (k: keyof ArticleForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const handleSave = async () => {
    if (!canManageKB) { showToast('error', 'Only Admins and PMO members can save articles'); return; }
    if (!form.title.trim()) { showToast('error', 'Title is required'); return; }
    if (!form.content.trim()) { showToast('error', 'Content is required'); return; }
    setSaving(true);
    try {
      // Feature 9.4: inject review date into tags before saving
      const tagsWithReview = injectReviewTag(form.tags, reviewDate);

      const payload = {
        cre09_cgmp_title: form.title.trim(),
        cre09_cgmp_category: parseInt(form.category) as unknown as Cre09_knowledgebasearticlescre09_cgmp_category,
        cre09_cgmp_content: form.content.trim(),
        cre09_cgmp_tags: tagsWithReview || undefined,
        cre09_cgmp_authorname: form.authorname.trim() || undefined,
        cre09_cgmp_ispublished: form.ispublished,
        cre09_cgmp_relatedchangeid: form.relatedchangeid.trim() || undefined,
        cre09_cgmp_relatedbridgeid: form.relatedbridgeid.trim() || undefined,
      };
      if (editArticle) {
        const upd = await Cre09_knowledgebasearticlesService.update(editArticle.cre09_knowledgebasearticleid, payload);
        if (!upd.success) throw upd.error ?? new Error('Failed to update article');
        // #80 Version History: record edit event as an annotation
        AnnotationsService.create({
          subject: 'KB Edit History',
          notetext: JSON.stringify({ title: payload.cre09_cgmp_title, author: payload.cre09_cgmp_authorname ?? '', timestamp: new Date().toISOString() }),
          isdocument: false,
          objecttypecode: 'cre09_knowledgebasearticles' as any,
          'ObjectId@odata.bind': `/cre09_knowledgebasearticless(${editArticle.cre09_knowledgebasearticleid})`,
          ownerid: '', owneridtype: '',
        } as any).catch(err => { if (import.meta.env.DEV) console.error('Background operation failed:', err); });
        showToast('success', 'Article updated');
      } else {
        const crt = await Cre09_knowledgebasearticlesService.create({
          ...payload,
        } as unknown as Omit<Cre09_knowledgebasearticlesBase, 'cre09_knowledgebasearticleid'>);
        if (!crt.success) throw crt.error ?? new Error('Failed to create article');
        showToast('success', 'Article created');
      }
      loadArticles();
      setFormOpen(false);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save article');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (!canManageKB) { showToast('error', 'Only Admins and PMO members can delete articles'); return; }
    try {
      await Cre09_knowledgebasearticlesService.delete(deleteTarget.cre09_knowledgebasearticleid);
      showToast('success', 'Article deleted');
      loadArticles();
      setDeleteTarget(null);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const doBulkPublish = async (publish: boolean) => {
    const ids = [...selectedArticleIds];
    if (ids.length === 0) return;
    setBulkPublishing(true);
    try {
      await Promise.all(ids.map(id =>
        Cre09_knowledgebasearticlesService.update(id, { cre09_cgmp_ispublished: publish } as any)
      ));
      showToast('success', `${ids.length} article${ids.length !== 1 ? 's' : ''} ${publish ? 'published' : 'unpublished'}`);
      setSelectedArticleIds(new Set());
      loadArticles();
    } catch {
      showToast('error', 'Bulk operation failed — some articles may not have been updated');
    } finally { setBulkPublishing(false); }
  };

  const formFooter = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label className="ff-label" style={{ margin: 0 }}>
          <input type="checkbox" checked={form.ispublished} onChange={setField('ispublished')} style={{ marginRight: 4 }} />
          Published
        </label>
        <button className="btn btn--xs btn--outline" onClick={() => setPreview(p => !p)}>
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
        <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : editArticle ? 'Update Article' : 'Publish Article'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Knowledge Base</h1>
          <p className="module-subtitle">SOPs, FAQs, runbooks, and lessons learned</p>
        </div>
        {canManageKB && <button className="btn btn--primary btn--sm" onClick={openCreate}>+ New Article</button>}
      </div>

      {/* Tabs */}
      <div className="ism-tabs" style={{ padding: '0 24px' }}>
        <button className={`ism-tab ${kbTab === 'articles' ? 'ism-tab--active' : ''}`} onClick={() => setKbTab('articles')}>
          All Articles ({articles.length})
        </button>
        <button className={`ism-tab ${kbTab === 'review-queue' ? 'ism-tab--active' : ''}`} onClick={() => setKbTab('review-queue')}>
          Review Queue {reviewQueue.length > 0 ? `(${reviewQueue.length})` : ''}
          {reviewQueue.length > 0 && <span className="kb-review-badge">{reviewQueue.length}</span>}
        </button>
      </div>

      {/* Review Queue Tab */}
      {kbTab === 'review-queue' && (
        <div className="module-table-wrap">
          {loading ? <div className="module-loading">Loading…</div> : reviewQueue.length === 0 ? (
            <div className="module-empty">No articles are past their review date.</div>
          ) : (
            <table className="ism-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Category</th>
                  <th>Author</th>
                  <th>Review Date</th>
                  <th>Overdue By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviewQueue.map(({ article: a, daysOverdue }) => (
                  <tr key={a.cre09_knowledgebasearticleid}>
                    <td>
                      <button className="kb-review-title-link" onClick={() => openRead(a)}>
                        {a.cre09_cgmp_title}
                      </button>
                    </td>
                    <td>
                      <span className={`badge badge--status ${CAT_CLASS[a.cre09_cgmp_category as unknown as number] ?? 'status-draft'}`}>
                        {CAT_LABEL[a.cre09_cgmp_category as unknown as number] ?? 'Unknown'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{a.cre09_cgmp_authorname ?? '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--danger)' }}>
                      {extractReviewDate(a.cre09_cgmp_tags) ?? '—'}
                    </td>
                    <td>
                      <span className="kb-overdue-badge">{daysOverdue}d overdue</span>
                    </td>
                    <td>
                      {canManageKB && <button className="btn btn--xs btn--outline" onClick={() => openEdit(a)}>Edit &amp; Review</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Filters */}
      {kbTab === 'articles' && <div className="filter-bar">
        <input className="filter-bar__search" placeholder="Search articles…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-bar__select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">All Categories</option>
          {CAT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="filter-bar__select" value={publishedFilter} onChange={e => setPublishedFilter(e.target.value)}>
          <option value="">All</option>
          <option value="true">Published</option>
          <option value="false">Drafts</option>
        </select>
        <span className="filter-bar__count">{filtered.length} articles</span>
      </div>}

      {/* Bulk Action Bar */}
      {kbTab === 'articles' && selectedArticleIds.size > 0 && (
        <div className="kb-bulk-bar">
          <span className="kb-bulk-bar__count">{selectedArticleIds.size} article{selectedArticleIds.size !== 1 ? 's' : ''} selected</span>
          <button className="btn btn--sm btn--primary" disabled={bulkPublishing} onClick={() => doBulkPublish(true)}>
            {bulkPublishing ? 'Publishing…' : 'Publish Selected'}
          </button>
          <button className="btn btn--sm btn--outline" disabled={bulkPublishing} onClick={() => doBulkPublish(false)}>
            Unpublish Selected
          </button>
          <button className="btn btn--sm btn--outline" onClick={() => setSelectedArticleIds(new Set())}>Clear</button>
        </div>
      )}

      {/* Content */}
      {kbTab === 'articles' && <div className="kb-content">
        {loading && <div className="module-loading">Loading articles…</div>}
        {!loading && filtered.length === 0 && <div className="module-empty">No articles found.</div>}
        {!loading && filtered.length > 0 && (
          catFilter ? (
            /* Flat list when filtering by category */
            <div className="kb-article-grid">
              {filtered.map(a => <ArticleCard key={a.cre09_knowledgebasearticleid} article={a} onRead={openRead} onEdit={openEdit} onDelete={setDeleteTarget} canManageKB={canManageKB} isAdmin={isAdmin} selected={selectedArticleIds.has(a.cre09_knowledgebasearticleid)} onSelectToggle={id => setSelectedArticleIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; })} />)}
            </div>
          ) : (
            /* Grouped by category */
            [...grouped.entries()].sort(([a], [b]) => a - b).map(([cat, articles]) => (
              <div key={cat} className="kb-category-group">
                <div className="kb-category-header">
                  <span className={`badge badge--status ${CAT_CLASS[cat] ?? 'status-draft'}`}>{CAT_LABEL[cat] ?? 'Unknown'}</span>
                  <span className="kb-cat-count">{articles.length} article{articles.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="kb-article-grid">
                  {articles.map(a => <ArticleCard key={a.cre09_knowledgebasearticleid} article={a} onRead={openRead} onEdit={openEdit} onDelete={setDeleteTarget} canManageKB={canManageKB} isAdmin={isAdmin} selected={selectedArticleIds.has(a.cre09_knowledgebasearticleid)} onSelectToggle={id => setSelectedArticleIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; })} />)}
                </div>
              </div>
            ))
          )
        )}
      </div>}

      {/* Article reader */}
      <SlidePanel
        open={!!readingArticle}
        onClose={() => setReadingArticle(null)}
        title={readingArticle?.cre09_cgmp_title ?? ''}
        subtitle={readingArticle ? `${CAT_LABEL[readingArticle.cre09_cgmp_category as unknown as number] ?? ''} · By ${readingArticle.cre09_cgmp_authorname ?? 'Unknown'} · ${readingArticle.cre09_cgmp_viewcount ?? 0} views` : ''}
        width={640}
      >
        {readingArticle && (
          <div className="kb-reader">
            {/* Tags (excluding review: tags from display) */}
            {readingArticle.cre09_cgmp_tags && (
              <div className="kb-tags">
                {readingArticle.cre09_cgmp_tags.split(',')
                  .map(t => t.trim())
                  .filter(t => !t.startsWith('review:'))
                  .map(t => (
                    <span key={t} className="kb-tag">{t}</span>
                  ))}
              </div>
            )}

            {/* Feature 9.2: Rating section */}
            <div className="kb-rating">
              <span className="kb-rating__label">Was this helpful?</span>
              <button
                className={`kb-rating__btn ${localRating === 'up' ? 'kb-rating__btn--active' : ''}`}
                onClick={() => rateArticle(readingArticle, 'up')}
                aria-label="Helpful"
                aria-pressed={localRating === 'up'}
              >
                👍
              </button>
              <button
                className={`kb-rating__btn ${localRating === 'down' ? 'kb-rating__btn--active' : ''}`}
                onClick={() => rateArticle(readingArticle, 'down')}
                aria-label="Not helpful"
                aria-pressed={localRating === 'down'}
              >
                👎
              </button>
            </div>

            {/* Feature 9.4: Stale banner */}
            {isStale(readingArticle.cre09_cgmp_tags) && (
              <div className="kb-stale-banner" role="alert">
                ⚠ This article is past its review date ({extractReviewDate(readingArticle.cre09_cgmp_tags)}). Please verify the content is still accurate.
              </div>
            )}

            <div
              className="kb-article-body"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderMarkdown(readingArticle.cre09_cgmp_content ?? '')) }}
            />

            <div className="kb-article-footer">
              {canManageKB && <button className="btn btn--xs btn--outline" onClick={() => openEdit(readingArticle)}>Edit Article</button>}
              {/* Feature 9.3: Linked change chip */}
              {readingArticle.cre09_cgmp_relatedchangeid && (
                <span className="kb-linked-change" title="Related change">
                  🔗 Change: {readingArticle.cre09_cgmp_relatedchangeid}
                </span>
              )}
            </div>

            {/* #80 Version History */}
            {(() => {
              const edits = kbAnnotations.filter(a => a.subject === 'KB Edit History');
              if (edits.length === 0 && readingArticle.modifiedon) {
                return (
                  <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Last Edited</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {fmtDateTime(readingArticle.modifiedon)}
                      {readingArticle.modifiedbyname ? ` by ${readingArticle.modifiedbyname}` : ''}
                    </div>
                  </div>
                );
              }
              if (edits.length === 0) return null;
              return (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>Edit History</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[...edits].reverse().map((e, i) => {
                      let info: { title?: string; author?: string; timestamp?: string } = {};
                      try { info = JSON.parse(e.notetext ?? '{}'); } catch {}
                      return (
                        <div key={e.annotationid ?? i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-secondary)', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-tertiary)', minWidth: 120 }}>{fmtDateTimeShort(info.timestamp)}</span>
                          <span>{info.author || 'Unknown'} edited</span>
                          {info.title && <span style={{ color: 'var(--text-tertiary)' }}>→ "{info.title}"</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* #77 Comments */}
            <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                Discussion ({kbAnnotations.filter(a => a.subject === 'KB Comment').length})
              </div>
              {annLoading ? (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading comments…</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                  {kbAnnotations.filter(a => a.subject === 'KB Comment').length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No comments yet — be the first.</div>
                  ) : (
                    kbAnnotations.filter(a => a.subject === 'KB Comment').map((c, i) => (
                      <div key={c.annotationid ?? i} style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{c.createdbyname || 'User'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtDateTimeShort(c.createdon)}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{c.notetext}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
              <textarea
                className="ff-input ff-textarea"
                rows={2}
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Add a comment…"
                style={{ fontSize: 13 }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button className="btn btn--sm btn--primary" disabled={addingComment || !newComment.trim()} onClick={addKbComment}>
                  {addingComment ? 'Posting…' : 'Post Comment'}
                </button>
              </div>
            </div>

            {/* Related Articles */}
            {relatedArticles.length > 0 && (
              <div className="kb-related">
                <p className="kb-related__heading">You might also find useful</p>
                <div className="kb-related__list">
                  {relatedArticles.map(a => (
                    <button
                      key={a.cre09_knowledgebasearticleid}
                      className="kb-related__item"
                      onClick={() => openRead(a)}
                    >
                      <span className={`badge badge--status ${CAT_CLASS[a.cre09_cgmp_category as unknown as number] ?? ''}`} style={{ fontSize: 10 }}>
                        {CAT_LABEL[a.cre09_cgmp_category as unknown as number] ?? 'Article'}
                      </span>
                      <span className="kb-related__title">{a.cre09_cgmp_title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SlidePanel>

      {/* Create/Edit form */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} title={editArticle ? 'Edit Article' : 'New Article'} maxWidth={700} footer={formFooter}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
          <div className="ff-row">
            <div className="ff-group" style={{ flex: 2 }}>
              <label className="ff-label">Title <span className="ff-required">*</span></label>
              <input className="ff-input" value={form.title} onChange={setField('title')} placeholder="Article title" />
            </div>
            <div className="ff-group">
              <label className="ff-label">Category</label>
              <select className="ff-input ff-select" value={form.category} onChange={setField('category')}>
                {CAT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="ff-row">
            <div className="ff-group">
              <label className="ff-label">Author Name</label>
              <input className="ff-input" value={form.authorname} onChange={setField('authorname')} placeholder="Author" />
            </div>
            <div className="ff-group">
              <label className="ff-label">Tags</label>
              <input className="ff-input" value={form.tags} onChange={setField('tags')} placeholder="Comma-separated tags" />
            </div>
          </div>

          {/* Feature 9.4: Review By Date field */}
          <div className="ff-group">
            <label className="ff-label">Review By Date</label>
            <input type="date" className="ff-input" value={reviewDate} onChange={e => setReviewDate(e.target.value)} />
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>If set, shows a stale warning after this date</span>
          </div>

          {/* Feature 9.3: Improved Linked Change field */}
          <div className="ff-group">
            <label className="ff-label">Linked Change Number</label>
            <input className="ff-input" value={form.relatedchangeid} onChange={setField('relatedchangeid')} placeholder="CHG-XXXXXX" />
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Link this article to a specific change by its change number</span>
          </div>

          <div className="ff-group">
            <label className="ff-label">Content (Markdown) <span className="ff-required">*</span></label>
            {/* Feature 9.1: Markdown toolbar (only when not in preview) */}
            {!preview && (
              <div className="kb-toolbar">
                <button type="button" className="kb-tb-btn" title="Bold" onClick={() => insertMarkdown(textareaRef, '**', '**')}>B</button>
                <button type="button" className="kb-tb-btn kb-tb-btn--italic" title="Italic" onClick={() => insertMarkdown(textareaRef, '*', '*')}>I</button>
                <button type="button" className="kb-tb-btn" title="Heading 2" onClick={() => insertMarkdown(textareaRef, '## ', '')}>H2</button>
                <button type="button" className="kb-tb-btn" title="Heading 3" onClick={() => insertMarkdown(textareaRef, '### ', '')}>H3</button>
                <button type="button" className="kb-tb-btn" title="Inline Code" onClick={() => insertMarkdown(textareaRef, '`', '`')}>{'\`'}</button>
                <button type="button" className="kb-tb-btn" title="Bullet List" onClick={() => insertMarkdown(textareaRef, '- ', '')}>•</button>
                <button type="button" className="kb-tb-btn" title="Numbered List" onClick={() => insertMarkdown(textareaRef, '1. ', '')}>1.</button>
                <button type="button" className="kb-tb-btn" title="Horizontal Rule" onClick={() => insertMarkdown(textareaRef, '\n---\n', '')}>—</button>
                <button type="button" className="kb-tb-btn" title="Link" onClick={() => insertMarkdown(textareaRef, '[', '](https://)', 'link text')}>🔗</button>
              </div>
            )}
            {preview ? (
              <div
                className="kb-preview-box"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderMarkdown(form.content)) }}
              />
            ) : (
              <textarea
                ref={textareaRef}
                className="ff-input ff-textarea"
                style={{ minHeight: 240, fontFamily: 'monospace', fontSize: 12 }}
                value={form.content}
                onChange={e => setForm(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Write content in Markdown…"
              />
            )}
          </div>
        </div>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { await handleDelete(); }}
        title="Delete Article"
        message={`Delete "${deleteTarget?.cre09_cgmp_title}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}

function ArticleCard({
  article, onRead, onEdit, onDelete, selected, onSelectToggle, canManageKB, isAdmin
}: {
  article: Cre09_knowledgebasearticles;
  onRead: (a: Cre09_knowledgebasearticles) => void;
  onEdit: (a: Cre09_knowledgebasearticles) => void;
  onDelete: (a: Cre09_knowledgebasearticles) => void;
  selected?: boolean;
  onSelectToggle?: (id: string) => void;
  canManageKB?: boolean;
  isAdmin?: boolean;
}) {
  const cat = article.cre09_cgmp_category as unknown as number;
  return (
    <div className={`kb-card${selected ? ' kb-card--selected' : ''}`}>
      <div className="kb-card__header">
        {onSelectToggle && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onSelectToggle(article.cre09_knowledgebasearticleid)}
            onClick={e => e.stopPropagation()}
            style={{ marginRight: 6, cursor: 'pointer' }}
            aria-label="Select article"
          />
        )}
        <span className={`badge badge--status ${CAT_CLASS[cat] ?? 'status-draft'}`} style={{ fontSize: 10 }}>{CAT_LABEL[cat]}</span>
        {!article.cre09_cgmp_ispublished && <span className="kb-draft-badge">Draft</span>}
        {/* Feature 9.4: Stale badge in card header */}
        {isStale(article.cre09_cgmp_tags) && <span className="kb-stale-badge" title="Review date has passed">⚠ Stale</span>}
      </div>
      <button className="kb-card__title" onClick={() => onRead(article)}>{article.cre09_cgmp_title || 'Untitled'}</button>
      <div className="kb-card__meta">
        {article.cre09_cgmp_authorname && <span>{article.cre09_cgmp_authorname}</span>}
        <span>{article.cre09_cgmp_viewcount ?? 0} views</span>
      </div>
      {article.cre09_cgmp_tags && (
        <div className="kb-tags" style={{ marginTop: 4 }}>
          {article.cre09_cgmp_tags.split(',')
            .map(t => t.trim())
            .filter(t => !t.startsWith('review:'))
            .slice(0, 3)
            .map(t => (
              <span key={t} className="kb-tag">{t}</span>
            ))}
        </div>
      )}
      <div className="kb-card__actions">
        {canManageKB && <button className="btn btn--xs btn--outline" onClick={() => onEdit(article)}>Edit</button>}
        {isAdmin && <button className="btn btn--xs btn--danger-outline" onClick={() => onDelete(article)}>Delete</button>}
      </div>
    </div>
  );
}

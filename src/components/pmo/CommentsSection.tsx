import { useState, useMemo } from 'react';
import { Cgmp_changesService } from '../../generated';
import type { HistoryEntry } from './VersionHistory';
import type { CommentDeletedEntry } from '../../types/changeHistory';
import { fmtDateTime } from '../../utils/format';

interface CommentEntry { _type: 'comment'; comment: string; user: string; timestamp: string; }

const EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function CommentsSection({
  changeId,
  historyJson,
  currentUser,
  onCommentAdded,
}: {
  changeId: string;
  historyJson: string | undefined;
  currentUser: string;
  onCommentAdded: () => void;
}) {
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingTs, setEditingTs] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const comments = useMemo<CommentEntry[]>(() => {
    try {
      const entries = JSON.parse(historyJson ?? '[]') as HistoryEntry[];
      return entries.filter((e): e is CommentEntry => e._type === 'comment');
    } catch { return []; }
  }, [historyJson]);

  const patchHistory = async (transform: (entries: HistoryEntry[]) => HistoryEntry[]) => {
    // Re-fetch the latest version history to avoid overwriting concurrent changes
    const latest = await Cgmp_changesService.get(changeId, { select: ['cgmp_versionhistory'] as any });
    let history: HistoryEntry[] = [];
    try { history = JSON.parse((latest.data?.cgmp_versionhistory ?? historyJson) ?? '[]'); } catch {}
    const updated = transform(history);
    const r = await Cgmp_changesService.update(changeId, { cgmp_versionhistory: JSON.stringify(updated) });
    if (!r.success) throw new Error('Save failed');
    onCommentAdded();
  };

  const addComment = async () => {
    if (!newComment.trim()) return;
    setSaving(true);
    try {
      const newEntry: CommentEntry = {
        _type: 'comment',
        comment: newComment.trim(),
        user: currentUser,
        timestamp: new Date().toISOString(),
      };
      await patchHistory(h => [...h, newEntry]);
      setNewComment('');
    } catch (err) {
      if (import.meta.env.DEV) console.error('Comment save failed', err);
    } finally { setSaving(false); }
  };

  const saveEdit = async (ts: string) => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await patchHistory(h => h.map(e =>
        e._type === 'comment' && (e as CommentEntry).timestamp === ts
          ? { ...e, comment: editText.trim() } as CommentEntry
          : e
      ));
      setEditingTs(null);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Edit failed', err);
    } finally { setSaving(false); }
  };

  const deleteComment = async (ts: string) => {
    setSaving(true);
    try {
      const tombstone: CommentDeletedEntry = {
        _type: 'comment_deleted',
        id: ts,
        timestamp: new Date().toISOString(),
        deletedBy: currentUser,
      };
      await patchHistory(h => h.map(e =>
        e._type === 'comment' && (e as CommentEntry).timestamp === ts
          ? tombstone
          : e
      ));
    } catch (err) {
      if (import.meta.env.DEV) console.error('Delete failed', err);
    } finally { setSaving(false); }
  };

  return (
    <div className="comments-section">
      <div className="comments-list">
        {comments.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No comments yet.</p>
        ) : (
          [...comments].reverse().map(c => {
            const canEdit = c.user === currentUser && Date.now() - new Date(c.timestamp).getTime() < EDIT_WINDOW_MS;
            const isEditing = editingTs === c.timestamp;
            return (
              <div key={c.timestamp} className="comment-item">
                <div className="comment-item__header">
                  <span className="comment-item__user">{c.user}</span>
                  <span className="comment-item__ts">{fmtDateTime(c.timestamp)}</span>
                  {canEdit && !isEditing && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn--xs btn--ghost"
                        style={{ fontSize: 11 }}
                        onClick={() => { setEditingTs(c.timestamp); setEditText(c.comment); }}
                      >Edit</button>
                      <button
                        className="btn btn--xs btn--ghost"
                        style={{ fontSize: 11, color: 'var(--danger)' }}
                        disabled={saving}
                        onClick={() => deleteComment(c.timestamp)}
                      >Delete</button>
                    </span>
                  )}
                </div>
                {isEditing ? (
                  <div style={{ marginTop: 6 }}>
                    <textarea
                      className="ff-input ff-textarea"
                      rows={2}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      style={{ fontSize: 13 }}
                      autoFocus
                    />
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
                      <button className="btn btn--xs btn--ghost" onClick={() => setEditingTs(null)}>Cancel</button>
                      <button className="btn btn--xs btn--primary" disabled={saving || !editText.trim()} onClick={() => saveEdit(c.timestamp)}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="comment-item__text">{c.comment}</p>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="comment-add">
        <textarea
          className="ff-input ff-textarea"
          rows={2}
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
          placeholder="Add a comment…"
          style={{ fontSize: 13 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn btn--sm btn--primary" onClick={addComment} disabled={saving || !newComment.trim()}>
            {saving ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

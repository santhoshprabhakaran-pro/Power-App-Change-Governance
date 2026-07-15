import { useApp } from '../../context/AppContext';
import { useChanges } from '../../context/ChangesContext';
import { statusLabel } from '../../utils/roles';
import { fmtDate } from '../../utils/format';

export function DeptAdminWorkspace() {
  const { currentUserName, assignedLocations } = useApp();
  const { changes, loading } = useChanges();

  const recentChanges = changes.slice(0, 20);

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Department Admin Workspace</h1>
          <p className="module-subtitle">
            {'Department Administrator'}
            {currentUserName && currentUserName !== 'Unknown User' ? ` — ${currentUserName}` : ''}
            {assignedLocations.length > 0 ? ` · ${assignedLocations.join(', ')}` : ''}
          </p>
        </div>
      </div>

      <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
            Recent Changes in Your Area
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
            Department Administrator access provides visibility into changes
            affecting your department. Contact your PMO for full change management access.
          </p>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  style={{ height: 44, background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}
                />
              ))}
            </div>
          ) : recentChanges.length === 0 ? (
            <div className="module-empty">No changes found.</div>
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-alt)' }}>
                    {(['Change #', 'Title', 'Status', 'Start Date'] as const).map(h => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left', padding: '8px 16px', fontSize: 12,
                          fontWeight: 600, color: 'var(--text-secondary)',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentChanges.map((change, i) => (
                    <tr
                      key={change.cgmp_changeid}
                      style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-alt)' }}
                    >
                      <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                        {change.cgmp_changenumber}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {change.cgmp_title}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{
                          padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: 'var(--surface-alt)', border: '1px solid var(--border)',
                          color: 'var(--text-secondary)', whiteSpace: 'nowrap',
                        }}>
                          {statusLabel(change.cgmp_status as unknown as number)}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                        {fmtDate(change.cgmp_starttime)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

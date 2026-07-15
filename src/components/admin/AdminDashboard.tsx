import { useState, useCallback, useEffect } from 'react';
import {
  Cgmp_changesService,
  Cgmp_bridgesService,
  Cgmp_tasksService,
  Cgmp_notificationsService,
  Cgmp_projectsService,
  Cgmp_userprofilesService,
  Cgmp_auditlogsService,
} from '../../generated';
import type { Cgmp_auditlogs } from '../../generated/models/Cgmp_auditlogsModel';
import { useApp } from '../../context/AppContext';
import { fmtDateTimeShort, getDisplayTimezone } from '../../utils/format';

const EVENT_TYPE_LABEL: Record<number, string> = {
  100000000: 'Login', 100000001: 'Logout', 100000002: 'Change Created',
  100000003: 'Change Updated', 100000004: 'Change Reviewed', 100000005: 'Change Released',
  100000006: 'Change Locked', 100000007: 'Change Completed', 100000008: 'Change Failed',
  100000009: 'Change Closed', 100000010: 'UAT Updated', 100000011: 'Bridge Created',
  100000012: 'Bridge Started', 100000013: 'Bridge Completed', 100000014: 'PIR Added',
  100000015: 'Project Updated', 100000016: 'Notification Sent',
  100000017: 'Escalation Triggered', 100000018: 'Settings Changed',
};

interface ServiceStatus {
  name: string;
  connected: boolean;
  count: number | null;
}

interface KpiData {
  totalChanges: number;
  activeBridges: number;
  openTasks: number;
  totalUsers: number;
}

function KpiSkeleton() {
  return <div style={{ height: 32, background: 'var(--surface-alt)', borderRadius: 4, width: '55%', marginTop: 4 }} />;
}

export default function AdminDashboard() {
  const { isAdmin, showToast } = useApp();
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [auditLogs, setAuditLogs] = useState<Cgmp_auditlogs[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // All service calls run in parallel — connectivity + row counts + audit log in one pass
      const [changesRes, bridgesRes, tasksRes, notifRes, projRes, usersRes, auditRes] =
        await Promise.allSettled([
          // Count-only: select only primary key to minimise payload (~97% bandwidth reduction)
          Cgmp_changesService.getAll({ top: 1000, select: ['cgmp_changeid'] }),
          // Needs cgmp_status to compute active-bridge sub-count
          Cgmp_bridgesService.getAll({ top: 1000, select: ['cgmp_bridgeid', 'cgmp_status'] }),
          // Needs cgmp_iscompleted to compute open-task sub-count
          Cgmp_tasksService.getAll({ top: 1000, select: ['cgmp_taskid', 'cgmp_iscompleted'] }),
          // Count-only: select only primary key
          Cgmp_notificationsService.getAll({ top: 1000, select: ['cgmp_notificationid'] }),
          // Count-only: select only primary key
          Cgmp_projectsService.getAll({ top: 1000, select: ['cgmp_projectid'] }),
          // Count-only: select only primary key
          Cgmp_userprofilesService.getAll({ top: 1000, select: ['cgmp_userprofileid'] }),
          // Activity feed — fetch 20 recent entries for display
          Cgmp_auditlogsService.getAll({ orderBy: ['createdon desc'], top: 20 }),
        ]);

      const changes = changesRes.status === 'fulfilled' ? (changesRes.value.data ?? []) : [];
      const bridges = bridgesRes.status === 'fulfilled' ? (bridgesRes.value.data ?? []) : [];
      const tasks   = tasksRes.status === 'fulfilled'   ? (tasksRes.value.data ?? [])   : [];
      const notifs  = notifRes.status === 'fulfilled'   ? (notifRes.value.data ?? [])   : [];
      const projs   = projRes.status === 'fulfilled'    ? (projRes.value.data ?? [])    : [];
      const users   = usersRes.status === 'fulfilled'   ? (usersRes.value.data ?? [])   : [];
      const audits  = auditRes.status === 'fulfilled'   ? (auditRes.value.data ?? [])   : [];

      // Active bridges: status Active (100000000) or Scheduled (100000004)
      const activeBridgeCount = bridges.filter(b => {
        const s = b.cgmp_status as unknown as number;
        return s === 100000000 || s === 100000004;
      }).length;

      // Open tasks: not completed
      const openTaskCount = tasks.filter(t => !t.cgmp_iscompleted).length;

      setKpi({
        totalChanges: changes.length,
        activeBridges: activeBridgeCount,
        openTasks: openTaskCount,
        totalUsers: users.length,
      });

      setServices([
        { name: 'Changes',       connected: changesRes.status === 'fulfilled', count: changesRes.status === 'fulfilled' ? changes.length : null },
        { name: 'Bridges',       connected: bridgesRes.status === 'fulfilled', count: bridgesRes.status === 'fulfilled' ? bridges.length : null },
        { name: 'Tasks',         connected: tasksRes.status === 'fulfilled',   count: tasksRes.status === 'fulfilled'   ? tasks.length   : null },
        { name: 'Notifications', connected: notifRes.status === 'fulfilled',   count: notifRes.status === 'fulfilled'   ? notifs.length  : null },
        { name: 'Projects',      connected: projRes.status === 'fulfilled',    count: projRes.status === 'fulfilled'    ? projs.length   : null },
        { name: 'User Profiles', connected: usersRes.status === 'fulfilled',   count: usersRes.status === 'fulfilled'   ? users.length   : null },
      ]);

      setAuditLogs(audits);
      setLastRefresh(new Date());
    } catch (err) {
      if (import.meta.env.DEV) console.error('AdminDashboard: load error', err);
      showToast('error', 'Failed to load admin dashboard data');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (isAdmin) loadAll();
  }, [isAdmin, loadAll]);

  if (!isAdmin) {
    return (
      <div className="workspace-placeholder workspace-placeholder--denied" role="alert">
        <span aria-hidden="true" style={{ fontSize: 48 }}>🔒</span>
        <h2>Access Denied</h2>
        <p>This page is only available to Administrators.</p>
      </div>
    );
  }

  const kpiTiles: { label: string; value: number | undefined; cap: number; color: string }[] = [
    { label: 'Total Changes',  value: kpi?.totalChanges,  cap: 1000, color: 'var(--primary)' },
    { label: 'Active Bridges', value: kpi?.activeBridges, cap: 1000, color: 'var(--warning)' },
    { label: 'Open Tasks',     value: kpi?.openTasks,     cap: 1000, color: 'var(--danger)'  },
    { label: 'Total Users',    value: kpi?.totalUsers,    cap: 1000, color: 'var(--success)' },
  ];

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Admin Health Dashboard</h1>
          <p className="module-subtitle">System health, API connectivity, and audit summary</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Refreshed {lastRefresh.toLocaleTimeString(undefined, { timeZone: getDisplayTimezone() })}
            </span>
          )}
          <button
            className="btn btn--sm btn--outline"
            onClick={loadAll}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── KPI tiles ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          {kpiTiles.map(({ label, value, cap, color }) => (
            <div key={label} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 20px',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
              {loading ? (
                <KpiSkeleton />
              ) : (
                <span style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1.2 }}>
                  {value !== undefined ? value : '—'}
                  {value !== undefined && value >= cap && (
                    <span
                      title="Results may be truncated — actual count could be higher"
                      style={{ fontSize: 14, cursor: 'help', marginLeft: 2, verticalAlign: 'super', lineHeight: 1 }}
                    >
                      *
                    </span>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* ── API Connectivity ── */}
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
            API Connectivity
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{
                  width: 130, height: 30, background: 'var(--surface)',
                  borderRadius: 16, border: '1px solid var(--border)',
                }} />
              ))
            ) : (
              services.map(svc => (
                <span key={svc.name} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 14px', borderRadius: 16, fontSize: 12, fontWeight: 500,
                  background: svc.connected
                    ? 'color-mix(in srgb, var(--success) 12%, transparent)'
                    : 'color-mix(in srgb, var(--danger) 12%, transparent)',
                  border: `1px solid ${svc.connected ? 'var(--success)' : 'var(--danger)'}`,
                  color: svc.connected ? 'var(--success)' : 'var(--danger)',
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: svc.connected ? 'var(--success)' : 'var(--danger)',
                    display: 'inline-block', flexShrink: 0,
                  }} />
                  {svc.name} — {svc.connected ? 'Connected' : 'Error'}
                </span>
              ))
            )}
          </div>
        </section>

        {/* ── Row Counts ── */}
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
            Dataverse Row Counts
          </h2>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-alt)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 16px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>Entity</th>
                  <th style={{ textAlign: 'right', padding: '8px 16px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>Row Count</th>
                  <th style={{ textAlign: 'center', padding: '8px 16px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-alt)' }}>
                      <td colSpan={3} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ height: 14, background: 'var(--border)', borderRadius: 4, width: `${40 + (i * 13) % 40}%` }} />
                      </td>
                    </tr>
                  ))
                ) : (
                  services.map((svc, i) => (
                    <tr key={svc.name} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-alt)' }}>
                      <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}>
                        {svc.name}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>
                        {svc.count === null ? '—' : svc.count >= 1000 ? '1000+' : svc.count}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                        <span style={{
                          padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: svc.connected
                            ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                            : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                          color: svc.connected ? 'var(--success)' : 'var(--danger)',
                        }}>
                          {svc.connected ? 'OK' : 'Error'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Recent Audit Events ── */}
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
            Recent Audit Events
          </h2>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{
                  height: 44, background: 'var(--surface)', borderRadius: 6,
                  border: '1px solid var(--border)',
                }} />
              ))}
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="module-empty">No audit events found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {auditLogs.map((log, i) => (
                <div key={log.cgmp_auditlogid ?? i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 14px',
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                  fontSize: 12,
                }}>
                  <span style={{ color: 'var(--text-secondary)', minWidth: 130, flexShrink: 0 }}>
                    {fmtDateTimeShort(log.createdon)}
                  </span>
                  <span style={{ fontWeight: 500, color: 'var(--text-primary)', minWidth: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.cgmp_username ?? log.createdbyname ?? '—'}
                  </span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 11,
                    background: 'var(--surface-alt)', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {EVENT_TYPE_LABEL[log.cgmp_eventtype as unknown as number] ?? 'Unknown'}
                  </span>
                  {log.cgmp_entityname && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.cgmp_entityname}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

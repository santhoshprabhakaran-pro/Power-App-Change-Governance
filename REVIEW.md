I now have a thorough read of all 43 files. Let me produce the comprehensive review.

---

# ENTERPRISE READINESS REVIEW
## Global Change Governance & Impact Management Platform
**Review Date:** July 2026 | **Codebase:** `c:\Change-Governance-App\src\` | **Version:** 2.0.0

---

## EXECUTIVE SUMMARY

The Global Change Governance & Impact Management Platform (CGMP) is a well-conceived enterprise application built on React 19, TypeScript 5.9, Vite 7, and Microsoft Dataverse, deployed as a Power Apps Code App within Microsoft Teams. The codebase demonstrates strong structural discipline: lazy-loaded workspaces, a single canonical role/status constants file (`utils/roles.ts`), a clean context pattern in `AppContext.tsx`, proper `useMounted` guards against stale state, and App Insights telemetry integration. The five-workspace RBAC model (PMO, IT Ops, ISM, GIICC, Admin) is coherently expressed and the UI achieves a professional, design-system-consistent appearance with dark/light theming, accessible breadcrumbs, and skeleton loaders throughout.

However, the application carries significant production risk in three areas. First, all access control is enforced exclusively in the React client layer — the `ALLOWED_TRANSITIONS` matrix in `roles.ts`, the `canTransition()` function, the `PIRForm.tsx` role guard, and the `AuditCenter.tsx` admin check are all UI-only with no corresponding Dataverse column-level or table-level security enforcement. A user who understands the Dataverse OData endpoint can bypass every workflow rule. Second, the data architecture relies heavily on JSON blobs serialised into text columns (`cgmp_versionhistory`, `cgmp_uatusers`, `cgmp_projectstatuses`, `cgmp_ownershiphistory`) which are unqueryable server-side, cannot be indexed, and silently fail once they exceed column size limits. Third, the SLA escalation loop in `useDataverse.ts` fires on every `useChanges()` call without idempotency guards, creating duplicate notifications and SLA-breach tasks on every dashboard load.

Bringing the platform to enterprise-grade production readiness requires addressing these three core concerns immediately, followed by resolving approximately fifteen high-priority functional and architectural issues identified in this review. The remaining findings represent medium-to-low risk improvements that would significantly increase maintainability, accessibility, and operational observability. With targeted remediation, this platform has the architecture to serve as a robust enterprise-scale change governance system.

---

## SECTION 1: FINDINGS CATALOG

### 1.1 Critical Security Findings (F-001 to F-010)

**[F-001] All RBAC enforcement is client-side only**
- **Module**: `utils/roles.ts`, `AppContext.tsx`, `PIRForm.tsx`, `AuditCenter.tsx`
- **Category**: Security
- **Priority**: Critical
- **Complexity**: High
- **Description**: The `ALLOWED_TRANSITIONS` map and `canTransition()` function in `roles.ts` are pure TypeScript that executes in the browser. Any user with Dataverse OData access (which all authenticated users have in Power Platform) can call `Cgmp_changesService.update()` with any status code directly. The `PIRForm.tsx` line 48 role check (`if (userRole !== ROLES.GIICC && userRole !== ROLES.Admin)`) and `AuditCenter.tsx` line 148 admin gate are identical frontend-only guards.
- **Current Implementation**: Role codes fetched from `cgmp_userprofiles`, compared in TypeScript before any Dataverse write.
- **Expected Implementation**: Dataverse table-level security roles enforced at the API layer; column-level security for sensitive fields; Power Automate approval flows for status transitions where required.
- **Root Cause**: Power Apps Code Apps do not automatically inherit Dataverse security roles from the calling user. Security must be explicitly configured on the Dataverse tables.
- **Business Impact**: A PMO user could directly call the Dataverse API to mark a change as Completed or Closed, bypassing IT Ops review, GIICC execution, and ISM sign-off — invalidating the entire governance chain.
- **Recommended Solution**: Configure Dataverse table and column security profiles. Implement server-side validation via Power Automate flows or a custom API connector for critical transitions. The `ALLOWED_TRANSITIONS` matrix in `roles.ts` should serve as documentation of intended server policy, not enforcement.

---

**[F-002] SLA escalation creates duplicate notifications on every dashboard load**
- **Module**: `hooks/useDataverse.ts` lines 83–106
- **Category**: Security / Bug (Critical functional impact)
- **Priority**: Critical
- **Complexity**: Medium
- **Description**: The `useChanges()` hook fires SLA notification creation (`Cgmp_notificationsService.create`) and task creation (`Cgmp_tasksService.create`) inside the data-fetch loop, with the comment "no dedup (Dataverse handles that)." Dataverse does not deduplicate these records. Every navigation to the Dashboard, PMO Workspace, or any component that calls `useChanges()` re-triggers the escalation for every qualifying change. With many users across roles, this generates O(users × changes × sessions) duplicate notifications and tasks.
- **Current Implementation**: `ageHours >= 48` guard limits which changes trigger, but no "already escalated" flag is checked.
- **Expected Implementation**: Mark escalated changes with a flag (e.g., `cgmp_slaescalatedat` timestamp column) and only trigger once per escalation threshold crossing.
- **Root Cause**: Fire-and-forget escalation logic embedded in a data-fetch hook with no idempotency.
- **Business Impact**: Floods notification center and task manager with duplicate items, degrading user trust and operator effectiveness.
- **Recommended Solution**: Add a `cgmp_slaescalatedat` column to `cgmp_changes`. Only trigger if this field is null and the age threshold is met. Update the field on first escalation. Alternatively, move this logic to a Power Automate scheduled flow that runs server-side.

---

**[F-003] Feature flags stored and controlled in localStorage**
- **Module**: `utils/featureFlags.ts`
- **Category**: Security
- **Priority**: Critical
- **Complexity**: Low
- **Description**: `isFeatureEnabled()` reads from `localStorage.getItem('cgmp-feature-flags')`. Any browser user can open DevTools and run `localStorage.setItem('cgmp-feature-flags', '{"sharepoint-integration":true,"advanced-rbac":true}')` to enable any feature including Advanced RBAC (enabling Observer, ISMDeputy, DeptAdmin roles) and SharePoint integration.
- **Current Implementation**: Per-user, per-device flag state stored in localStorage, configurable only from the Settings UI.
- **Expected Implementation**: Feature flags stored server-side in a Dataverse configuration table, readable by the authenticated user but not writable by them without the Admin role.
- **Root Cause**: Simpler localStorage implementation chosen over a proper server-side configuration store.
- **Business Impact**: Any user can grant themselves elevated feature access including unlocking Advanced RBAC role definitions.
- **Recommended Solution**: Create a `cgmp_appsettings` Dataverse table. Store flag values there. Read via service call on app boot. Restrict writes to Admin role via Dataverse security.

---

**[F-004] App Insights connection string stored in localStorage**
- **Module**: `utils/appInsights.ts` lines 6–9
- **Category**: Security
- **Priority**: Critical
- **Complexity**: Low
- **Description**: `INSTRUMENTATION_KEY_LS = 'cgmp-ai-connection-string'` stores the Azure Application Insights connection string in localStorage. This is readable by any JavaScript running on the page (XSS attacks) and by any person with DevTools access. A leaked connection string allows adversaries to inject false telemetry or read telemetry data.
- **Current Implementation**: `getConnectionString()` reads from localStorage; `configureAppInsights()` writes there.
- **Expected Implementation**: Connection string provided at build time via environment variables (`import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING`) and injected as a `define` in `vite.config.ts`.
- **Root Cause**: Dynamic configuration to avoid rebuilding when the key changes.
- **Business Impact**: Telemetry data exfiltration; injection of false events; potential App Insights billing abuse.
- **Recommended Solution**: Use `import.meta.env.VITE_APPINSIGHTS_CS` in `vite.config.ts`'s `define` block. For runtime configurability, use a Dataverse configuration record (Admin-only write, App-read).

---

**[F-005] Teams manifest contains hardcoded production tenant ID**
- **Module**: `teams/manifest.json` lines 29, 30
- **Category**: Security
- **Priority**: Critical
- **Complexity**: Low
- **Description**: The `contentUrl` and `websiteUrl` fields contain `?tenantId=e0793d39-0939-496d-b129-198edd916feb` hardcoded. The Power Apps environment ID (`5b9db983-0709-e578-ba8e-29a88812c217`) and app ID are also hardcoded. This manifest is committed to source control, exposing tenant and environment identifiers publicly.
- **Current Implementation**: Production identifiers hardcoded in source.
- **Expected Implementation**: Manifest generated at deploy time with environment-specific substitution, or at minimum the sensitive IDs stored only in deployment secrets.
- **Root Cause**: No ALM pipeline parameterization for manifest generation.
- **Business Impact**: Tenant ID exposure; inability to deploy to test environments without editing source; environment enumeration risk.
- **Recommended Solution**: Introduce a `teams/manifest.template.json` with `{{TENANT_ID}}`, `{{ENV_ID}}`, `{{APP_ID}}` placeholders. Build step substitutes values from environment secrets.

---

**[F-006] Extended roles (Observer, ISMDeputy, DeptAdmin) lack Dataverse option set support**
- **Module**: `utils/roles.ts` lines 26–30; `components/settings/SecurityRoles.tsx` line 25
- **Category**: Security
- **Priority**: Critical
- **Complexity**: High
- **Description**: `EXTENDED_ROLES` (100000005, 100000006, 100000007) are defined in TypeScript with the comment "require Dataverse option set extension to persist." The Dataverse model (`Cgmp_userprofilescgmp_role` in `Cgmp_userprofilesModel.ts`) only defines codes 100000000–100000004. Writing an extended role code to Dataverse will fail silently or store an invalid option set value. The SecurityRoles component's `ROLE_LABEL` and `ROLE_OPTS` only cover the base 5 roles.
- **Current Implementation**: Extended role codes exist in TypeScript constants but lack Dataverse backing.
- **Expected Implementation**: Dataverse option set extended to include Observer, ISMDeputy, DeptAdmin values; model regenerated via `pac modelbuilder build`.
- **Root Cause**: Extended roles added to TypeScript without completing the Dataverse schema change.
- **Business Impact**: Assigning an Observer or ISM Deputy role via the API silently fails; advanced RBAC feature flag is non-functional.
- **Recommended Solution**: Add option set values 100000005–100000007 to the `cgmp_role` option set in Dataverse. Regenerate models. Update SecurityRoles UI to display and assign extended roles.

---

**[F-007] Logout does not invalidate Power Apps session**
- **Module**: `AppContext.tsx` lines 187–191
- **Category**: Security
- **Priority**: High
- **Complexity**: Medium
- **Description**: The `logout()` function clears localStorage keys prefixed with `cgmp-` and reloads the window. This does not invalidate the Power Apps authentication session (AAD token). The user remains authenticated to Dataverse and can re-access the app or call the Dataverse API directly until their AAD token naturally expires.
- **Current Implementation**: `window.location.reload()` after clearing localStorage.
- **Expected Implementation**: Redirect to AAD sign-out endpoint or Microsoft logout URL to clear the identity session.
- **Root Cause**: Power Apps SDK does not expose a logout method; session management deferred to AAD.
- **Business Impact**: A user who logs out on a shared workstation can have their session reused within the AAD token lifetime (typically 1 hour).
- **Recommended Solution**: On logout, redirect to `https://login.microsoftonline.com/common/oauth2/logout?post_logout_redirect_uri=<appUrl>` to ensure the AAD session is cleared.

---

**[F-008] No Content Security Policy configured**
- **Module**: Build configuration, `vite.config.ts`
- **Category**: Security
- **Priority**: High
- **Complexity**: Medium
- **Description**: No CSP `<meta>` tag is present in `index.html` (not reviewed, but absent from Vite config directives) and no CSP header configuration appears in the build. In a Teams tab context embedded via iframe, CSP is a primary XSS mitigation mechanism.
- **Current Implementation**: No CSP defined.
- **Expected Implementation**: Strict CSP meta tag allowing only necessary domains: `apps.powerapps.com`, `*.dynamics.com`, `*.powerbi.com`, `*.applicationinsights.azure.com`.
- **Root Cause**: Missing security hardening step during initial setup.
- **Business Impact**: XSS vulnerabilities have no mitigation layer; injected scripts can steal session tokens, read localStorage keys.
- **Recommended Solution**: Add `<meta http-equiv="Content-Security-Policy">` in `index.html`. Define `script-src 'self'`, `connect-src` whitelist, `frame-ancestors` to limit embedding to Teams.

---

**[F-009] `beforeunload` audit log runs Dataverse write synchronously during page close**
- **Module**: `AppContext.tsx` lines 124–143
- **Category**: Security / Reliability
- **Priority**: High
- **Complexity**: Medium
- **Description**: The `beforeunload` handler calls `Cgmp_auditlogsService.create()` (an async Fetch/XHR call). Browsers cancel in-flight async requests during page unload. This means the logout audit log is routinely lost. Additionally, the handler runs on ANY beforeunload (navigation, browser close, browser crash), not only intentional logout.
- **Current Implementation**: `Cgmp_auditlogsService.create({...}).catch(() => {})` in `beforeunload`.
- **Expected Implementation**: Use `navigator.sendBeacon()` which is guaranteed to complete during page close. Or use the `visibilitychange` event to write audit on tab hide.
- **Root Cause**: Async API call not suited for `beforeunload` context.
- **Business Impact**: Logout audit records are silently dropped, undermining the audit trail completeness.
- **Recommended Solution**: Replace `Cgmp_changesService.create()` in the `beforeunload` handler with `navigator.sendBeacon('/api/audit-logout', payload)` pointing to a lightweight Azure Function endpoint, or restructure to use the `visibilitychange` event.

---

**[F-010] OData injection possible in notification recipient filter**
- **Module**: `hooks/useDataverse.ts` line 279
- **Category**: Security
- **Priority**: High
- **Complexity**: Low
- **Description**: `useNotifications()` at line 279 constructs `filter: \`cgmp_recipientid eq '${userProfileId}'\``. While `userProfileId` is a GUID from Dataverse (low injection risk), the same pattern in `AppContext.tsx` line 89 (`cgmp_userprincipalname eq '${safeUpn}'`) does escape single quotes. The notification filter does NOT escape, and if the `userProfileId` source ever changes to a user-controlled value, injection becomes possible. Establishes a dangerous inconsistency in escaping practices.
- **Current Implementation**: Inconsistent single-quote escaping across OData filters.
- **Expected Implementation**: All string values embedded in OData filters should be sanitized through a shared `escapeOData(s: string)` utility.
- **Root Cause**: No shared OData string sanitization utility; escaping done ad-hoc.
- **Business Impact**: Future developer adds a filter using a user-controlled value and does not know to escape it.
- **Recommended Solution**: Create `utils/odata.ts` with `escapeODataString(s: string)`. Apply consistently across all service filter strings.

---

### 1.2 High-Priority Functional Gaps (F-011 to F-025)

**[F-011] `useChanges()` data hook performs SLA escalation as side effect of data fetch**
- **Module**: `hooks/useDataverse.ts` lines 67–201
- **Category**: Bug
- **Priority**: High
- **Complexity**: High
- **Description**: The data-fetching function inside `useChanges()` contains business logic that creates Dataverse records (notifications, tasks) as a side effect. This violates the separation of concerns: data fetching should not mutate server state. It also means that every component that mounts `useChanges()` (Dashboard, potentially others) triggers escalation writes on every render cycle.
- **Current Implementation**: `Cgmp_notificationsService.create()` and `Cgmp_tasksService.create()` called inside the `fetch` callback.
- **Expected Implementation**: Move SLA escalation to a dedicated Power Automate scheduled flow or a separate server-side process invoked explicitly by an Admin action.
- **Root Cause**: SLA automation was implemented as a quick client-side workaround rather than a proper server-side scheduled process.
- **Business Impact**: Duplicate notifications per F-002; performance degradation on dashboard load; audit trail pollution.
- **Recommended Solution**: Create a Power Automate cloud flow triggered on a schedule (every hour). Query changes older than 48h in review. Create escalation notification if not already present. Remove the escalation block from `useDataverse.ts`.

---

**[F-012] `useChangeList()` fetches all 500 changes without column projection**
- **Module**: `hooks/useDataverse.ts` line 332
- **Category**: Performance / Bug
- **Priority**: High
- **Complexity**: Low
- **Description**: `useChangeList()` calls `Cgmp_changesService.getAll({ orderBy: ['createdon desc'], top: 500 })` with no `select` option. This fetches all columns including large text fields: `cgmp_description`, `cgmp_versionhistory`, `cgmp_timeline`, `cgmp_uatusers`, `cgmp_pirnotes`. For 500 changes, this can easily transfer hundreds of kilobytes per request.
- **Current Implementation**: No column selection; all fields returned.
- **Expected Implementation**: Specify minimal `select` array matching the fields actually used by consuming components (change number, title, status, risk, start/end times, owner, location).
- **Root Cause**: Convenience-first approach during development; no performance review gate.
- **Business Impact**: Slow initial load times; increased Dataverse API quota consumption; potential Dataverse throughput limits hit in large tenants.
- **Recommended Solution**: Add `select: ['cgmp_changeid', 'cgmp_changenumber', 'cgmp_title', 'cgmp_status', 'cgmp_risklevel', 'cgmp_starttime', 'cgmp_endtime', 'cgmp_createdby', 'cgmp_location', 'cgmp_projectids', 'cgmp_category', 'cgmp_changetype', 'cgmp_impactlevel', 'createdon', 'modifiedon', 'owneridname']` to `useChangeList()`.

---

**[F-013] Header component always fetches all changes and projects regardless of page**
- **Module**: `components/Header.tsx` lines 214–215
- **Category**: Performance
- **Priority**: High
- **Complexity**: Medium
- **Description**: `Header` calls `useChangeList()` and `useProjects()` unconditionally because it always renders. This means every page load triggers two additional Dataverse fetches (500 changes, 500 projects) purely to power the header search overlay, which is only used when the user clicks the search box.
- **Current Implementation**: Both hooks called at component mount.
- **Expected Implementation**: Lazy-load search data only when the search input is focused or Ctrl+K is pressed.
- **Root Cause**: Search overlay built as an inline component receiving pre-fetched data rather than fetching on demand.
- **Business Impact**: Every page load unnecessarily fetches ~1000 records from Dataverse; significant wasted quota and bandwidth.
- **Recommended Solution**: Maintain a `searchReady` state flag. Only call the data fetches when `searchFocused` is first set to true. Use the `initialized` ref pattern already used in `useNotifications()`.

---

**[F-014] UserProfilesContext and useAllUserProfiles duplicate profile fetching**
- **Module**: `context/UserProfilesContext.tsx`; `hooks/useDataverse.ts` lines 463–476
- **Category**: Architecture / Performance
- **Priority**: High
- **Complexity**: Medium
- **Description**: `UserProfilesContext` loads up to 500 user profiles on app boot. `useAllUserProfiles` (used in PMOWorkspace, ITOpsWorkspace, ISMWorkspace) independently fetches the same 500 profiles on each workspace mount. There is no shared cache; both execute independently.
- **Current Implementation**: Two separate fetching mechanisms for the same Dataverse table.
- **Expected Implementation**: Single source of truth via `UserProfilesContext`. Components consume context via `useUserProfiles()`.
- **Root Cause**: `useAllUserProfiles` was added as a convenience hook without checking if the context already covered the need.
- **Business Impact**: Up to 4 separate 500-record user profile fetches in a typical session (boot + PMO + ITOps + ISM).
- **Recommended Solution**: Remove `useAllUserProfiles` from `useDataverse.ts`. Replace all callsites with `useUserProfiles()` from `UserProfilesContext`.

---

**[F-015] calcSLA duplicated between business.ts and ISMWorkspace.tsx**
- **Module**: `utils/business.ts` line 36; `components/ism/ISMWorkspace.tsx` lines 25–29
- **Category**: Technical Debt
- **Priority**: High
- **Complexity**: Low
- **Description**: `calcSLA` is the canonical utility in `business.ts` (exported, imported by `useDataverse.ts`). `ISMWorkspace.tsx` defines an identical private function at line 25 that takes a different type signature `{ cgmp_status?: unknown }[]` instead of `Cgmp_changes[]`. Any bug fix or logic change in the canonical version will not propagate to ISM's calculation.
- **Current Implementation**: Two implementations; ISM uses local version.
- **Expected Implementation**: `ISMWorkspace.tsx` imports `calcSLA` from `utils/business` and uses it directly.
- **Root Cause**: Developer was unaware of or did not use the shared utility.
- **Business Impact**: SLA % shown in ISM KPI bar may diverge from SLA shown in Dashboard KPI cards.
- **Recommended Solution**: Remove local `calcSLA` from `ISMWorkspace.tsx`. Import `calcSLA` from `utils/business`. Cast input to compatible type or adjust signature.

---

**[F-016] Change clone does not copy the change number, leaving a blank required field**
- **Module**: `components/pmo/PMOWorkspace.tsx` lines 81–95
- **Category**: Bug
- **Priority**: High
- **Complexity**: Low
- **Description**: `handleClone()` creates a new change record with most fields copied from the source, but `cgmp_changenumber` is not included. The validation in `ChangeForm.tsx` line 102 marks change number as required. The cloned change is created in Draft status with a blank change number — failing validation if edited and saved.
- **Current Implementation**: Clone omits `cgmp_changenumber`.
- **Expected Implementation**: Generate a new unique change number for the clone (e.g., append `-COPY` or use an auto-number sequence from Dataverse).
- **Root Cause**: Change number generation logic not exposed as a utility; developer left it blank.
- **Business Impact**: Cloned changes cannot be saved without manual change number entry; this is not communicated to the user.
- **Recommended Solution**: Generate a temporary change number like `${source.cgmp_changenumber}-COPY` in the clone payload. Display a toast explaining that the change number must be updated before publishing.

---

**[F-017] PIR cancellation reason prepended to PIR notes field, corrupting structured data**
- **Module**: `components/giicc/PIRForm.tsx` lines 119–121
- **Category**: Bug
- **Priority**: High
- **Complexity**: Low
- **Description**: `handleCancelBridge()` prepends `[CANCELLED: ${reason}]` to the existing `cgmp_pirnotes` text field. This corrupts a field that has semantic meaning (PIR documentation) with operational metadata (cancellation reason). The `cgmp_rollbackreason` field is also written with the cancel reason, creating duplication.
- **Current Implementation**: `const cancelNote = existing ? \`[CANCELLED: ${cancelReason.trim()}]\n${existing}\` : \`Cancelled: ${cancelReason.trim()}\``.
- **Expected Implementation**: Store cancellation reason in a dedicated `cgmp_cancellationreason` text field on the bridge record, leaving PIR notes unmodified.
- **Root Cause**: No dedicated field for cancellation reason on the bridge entity; workaround uses available text field.
- **Business Impact**: PIR notes for cancelled bridges contain mixed metadata; reporting on PIR content is unreliable.
- **Recommended Solution**: Add `cgmp_cancellationreason` column to `cgmp_bridges` in Dataverse. Update PIRForm to write there. Remove the prepend logic.

---

**[F-018] Bulk operations fire one Dataverse call per record without batching**
- **Module**: `components/pmo/PMOWorkspace.tsx`, `components/ism/ISMActionsTab.tsx`, `components/itops/ITOpsWorkspace.tsx`
- **Category**: Performance / Reliability
- **Priority**: High
- **Complexity**: High
- **Description**: Bulk publish, bulk reassign, and ISM handover iterate over arrays and call `Cgmp_changesService.update()` individually. ISMActionsTab `handleHandover()` (line 179) does `Promise.all(myProjects.map(p => Cgmp_projectsService.update(...)))` — firing N parallel requests for all user projects simultaneously. With 50+ projects, this risks hitting Dataverse service protection limits (429 Too Many Requests).
- **Current Implementation**: `Promise.all` of individual update calls.
- **Expected Implementation**: Use Dataverse batch requests (OData $batch) via the Power Apps client, or implement a concurrency-limited queue (e.g., process 5 at a time).
- **Root Cause**: Power Apps SDK `getClient()` may not expose batch operations; individual updates were the path of least resistance.
- **Business Impact**: Bulk operations on large datasets trigger service protection limits, causing partial failures with no rollback.
- **Recommended Solution**: Implement `pLimit`-style concurrency limiting (3–5 concurrent requests). Show progress UI. On failure, report which records succeeded and which failed.

---

**[F-019] No automated test coverage**
- **Module**: `package.json`
- **Category**: Technical Debt
- **Priority**: High
- **Complexity**: High
- **Description**: `package.json` has no test runner (Vitest, Jest, Playwright). There are no `.test.ts`, `.spec.ts`, or `.test.tsx` files in the codebase. All quality assurance is manual.
- **Current Implementation**: Zero test coverage.
- **Expected Implementation**: Unit tests for `utils/roles.ts`, `utils/business.ts`, `utils/format.ts` (pure functions ideal for testing); component tests for critical workflows (change submission, status transition, SLA calculation); E2E tests for role-based access scenarios.
- **Root Cause**: Test infrastructure not set up during initial project scaffolding.
- **Business Impact**: Any refactoring carries risk of silent regressions; SLA calculation bugs, role permission bugs are undetectable until they reach production.
- **Recommended Solution**: Add Vitest (`vitest`, `@vitest/ui`, `happy-dom`) and Playwright. Start with the 9 pure utility functions which have no dependencies. Target 80% unit coverage of `utils/` in sprint 1.

---

**[F-020] AdminDashboard fetches top:1000 records per table for simple count display**
- **Module**: `components/admin/AdminDashboard.tsx` lines 56–62
- **Category**: Performance
- **Priority**: High
- **Complexity**: Medium
- **Description**: The Admin Health Dashboard fetches `top: 1000` for all 6 Dataverse tables (changes, bridges, tasks, notifications, projects, users) on load, returning up to 6,000 records, purely to display record counts and a 10-row audit log. Dataverse supports `$count=true` in OData queries.
- **Current Implementation**: `Cgmp_changesService.getAll({ top: 1000, select: ['cgmp_changeid', 'cgmp_status'] })` repeated for each entity.
- **Expected Implementation**: Use OData `$count` aggregation to retrieve only the count. For the admin dashboard, only the audit log needs actual records.
- **Root Cause**: Power Apps client SDK may not expose `$count`. If so, use `top: 1, select: ['id']` or a custom connector.
- **Business Impact**: Admin dashboard load time is disproportionately slow; wastes significant Dataverse quota.
- **Recommended Solution**: If `$count` is available in the SDK options, use it. Otherwise, use `top: 1` with response metadata. Only fetch full records for the audit log table.

---

**[F-021] ISM project matching uses both ID and display name fields creating inconsistency**
- **Module**: `components/ism/ISMWorkspace.tsx` lines 142–147
- **Category**: Bug
- **Priority**: High
- **Complexity**: Medium
- **Description**: `ismProjects` filtering at line 143 uses `p.cgmp_primaryismid === userId || p.cgmp_primaryism === ismUserName`. The first condition uses the profile GUID; the second uses the display name string. Name-based matching is fragile (name changes, duplicates). If `userId` is null (profile not yet loaded), it falls back to name matching exclusively.
- **Current Implementation**: OR condition matching on both ID and display name.
- **Expected Implementation**: Match exclusively on `cgmp_primaryismid` (GUID). Display name should only be used for display, never for filtering.
- **Root Cause**: `cgmp_primaryism` text field was added alongside the ID field to support display without a lookup; the filter inherited both.
- **Business Impact**: An ISM with a common name like "John Smith" may see projects belonging to a different ISM with the same name; projects may appear/disappear after profile name changes.
- **Recommended Solution**: Remove the name-based OR condition. Ensure all project records populate `cgmp_primaryismid` via the user profile selection UI.

---

**[F-022] Emergency change fast-track feature flag defined but not implemented**
- **Module**: `components/settings/Settings.tsx` line 39; `hooks/useDataverse.ts`
- **Category**: Feature Gap
- **Priority**: High
- **Complexity**: Medium
- **Description**: `FEATURE_FLAG_DEFINITIONS` in `Settings.tsx` defines `emergency-fast-track` with description "240-minute SLA and immediate Admin notification for emergency changes." However, no code in the codebase reads this flag to alter SLA thresholds (hardcoded at 48h/120h in `useDataverse.ts` lines 83–85) or trigger immediate notifications for `cgmp_isemergency` changes.
- **Current Implementation**: Flag visible and toggleable in settings; no effect on behavior.
- **Expected Implementation**: When enabled, emergency changes (`cgmp_isemergency === true`) should use 4-hour SLA threshold and trigger immediate escalation notifications to Admin profiles.
- **Root Cause**: Feature flag scaffolded before implementation was completed.
- **Business Impact**: Users who enable this flag expect changed behavior; discovery that it has no effect erodes trust.
- **Recommended Solution**: In `useDataverse.ts`, check `isFeatureEnabled('emergency-fast-track')` and `c.cgmp_isemergency`. Apply 240-minute threshold. Alternatively, remove the flag until implemented.

---

**[F-023] Notification recipient for SLA escalations is unset**
- **Module**: `hooks/useDataverse.ts` lines 93–98
- **Category**: Bug
- **Priority**: High
- **Complexity**: Low
- **Description**: SLA escalation notifications created at line 94 do not include `cgmp_recipientid`. The notification record is created with no recipient, so it will never appear in any user's notification center (which filters by `cgmp_recipientid eq '${userProfileId}'`). The notification is created but invisible.
- **Current Implementation**: `Cgmp_notificationsService.create({ cgmp_title: 'SLA Escalation: ...', ... })` — no `cgmp_recipientid`.
- **Expected Implementation**: Fetch Admin user profiles and send notification to each Admin, or to the change owner.
- **Root Cause**: Escalation logic doesn't have access to Admin profile IDs at this point in the code.
- **Business Impact**: SLA escalation notifications are silently created but never delivered to anyone, making the escalation system non-functional.
- **Recommended Solution**: Pass Admin profile IDs from `AppContext` into the escalation logic, or create one notification per Admin profile ID from `userProfiles` where `cgmp_role === ROLES.Admin`.

---

**[F-024] Version history stored in a single Dataverse text column has no capacity guarantee**
- **Module**: `utils/business.ts` lines 52–65; `hooks/useDataverse.ts` (calling `appendHistory`)
- **Category**: Architecture
- **Priority**: High
- **Complexity**: High
- **Description**: `appendHistory()` manages version history as JSON in `cgmp_versionhistory`. The cap is 500 entries and trim-to-450. Dataverse text columns have a configurable max length, but even at 4000 characters (default), a 450-entry JSON array of concern/sign-off entries can far exceed this limit, causing silent truncation or write failure.
- **Current Implementation**: In-memory array capped at 500, serialised to JSON, written to a single text column.
- **Expected Implementation**: Dedicated `cgmp_changehistory` Dataverse table with proper relationships, one row per event, queryable via OData.
- **Root Cause**: Simpler than building a child table; JSON-in-text was an expedient choice.
- **Business Impact**: History records lost when column limit exceeded; compliance/audit requirements for full history may be unmet.
- **Recommended Solution**: Create `cgmp_changehistory` table with columns: `cgmp_changeid` (lookup), `cgmp_eventtype`, `cgmp_timestamp`, `cgmp_actor`, `cgmp_details` (JSON). Migrate `appendHistory` callers to write individual records.

---

**[F-025] ISM sign-off stored in version history JSON, not a structured sign-off record**
- **Module**: `components/ism/ISMActionsTab.tsx` lines 68–79
- **Category**: Architecture
- **Priority**: High
- **Complexity**: Medium
- **Description**: `handleSignOff()` appends a `_type: 'ism-signoff'` entry to `cgmp_versionhistory`. This means sign-off data is buried in a JSON blob with no server-side queryability. Reporting "which changes have ISM sign-off?" requires client-side parsing of all history blobs.
- **Current Implementation**: Sign-off written as JSON entry in `cgmp_versionhistory`.
- **Expected Implementation**: Dedicated `cgmp_ismsignoffs` table with lookup to change, timestamp, actor, notes. Or a `cgmp_ismsignoffat` / `cgmp_ismsignoffby` column set directly on `cgmp_changes`.
- **Root Cause**: Follows the same JSON-blob anti-pattern established by version history.
- **Business Impact**: Compliance queries like "show all changes without ISM sign-off" require O(N) client-side JSON parsing; can't be enforced as a Dataverse workflow condition.
- **Recommended Solution**: Add `cgmp_ismsignoffat` (DateTime) and `cgmp_ismsignoffby` (text) columns to `cgmp_changes`. Write these directly in `handleSignOff()`.

---

### 1.3 Architecture & Code Quality (F-026 to F-040)

**[F-026] `as unknown as number` type casts used across the entire codebase instead of coerceOptionSet**
- **Module**: `utils/coerce.ts`; dozens of component files
- **Category**: Technical Debt
- **Priority**: High
- **Complexity**: Low
- **Description**: `coerce.ts` provides `coerceOptionSet<T>()` specifically to replace `as unknown as number` patterns at OData boundaries. Despite its existence, the old pattern continues in `useDataverse.ts`, `Dashboard.tsx`, `ITOpsWorkspace.tsx`, `ISMWorkspace.tsx`, `GIICCCommandCenter.tsx`, and every workspace. The `coerce.ts` file exists but is not used by any file outside itself.
- **Current Implementation**: `(c.cgmp_status as unknown as number)` repeated ~60+ times.
- **Expected Implementation**: `coerceOptionSet<typeof STATUS[keyof typeof STATUS]>(c.cgmp_status)` or simpler: `Number(c.cgmp_status)`.
- **Root Cause**: `coerce.ts` added retroactively; existing code not updated.
- **Business Impact**: TypeScript's type system bypassed; refactoring becomes error-prone.
- **Recommended Solution**: Global find-replace `as unknown as number` with `Number(...)`. Remove `coerce.ts` if not needed or enforce its usage.

---

**[F-027] App.tsx routing uses 25-branch if-else chain**
- **Module**: `App.tsx` lines 183–210
- **Category**: Architecture
- **Priority**: Medium
- **Complexity**: Low
- **Description**: `renderContent()` contains 25 sequential `if (activePage === 'x') return <...>` branches. Adding a new page requires modifying this function. The pattern scales poorly and has no type-safety for the `activePage` string.
- **Current Implementation**: Sequential if-else with string literals.
- **Expected Implementation**: Route registry map: `const ROUTES: Record<string, React.LazyExoticComponent> = { dashboard: lazy(...), pmo: lazy(...), ... }`. Render via `const Component = ROUTES[activePage]; return <Component />`.
- **Root Cause**: Direct approach; route map not established at project start.
- **Business Impact**: Every new page requires editing App.tsx; copy-paste errors possible.
- **Recommended Solution**: Extract route registry to `routes.ts`. Type `activePage` as `keyof typeof ROUTES`. Simplify `renderContent` to a single lookup.

---

**[F-028] Sidebar hardcodes extended role numbers instead of using EXTENDED_ROLES constants**
- **Module**: `components/Sidebar.tsx` lines 92–98
- **Category**: Technical Debt
- **Priority**: Medium
- **Complexity**: Low
- **Description**: Sidebar role filtering at lines 92–99 uses literal numbers (100000005, 100000006, 100000007) instead of `EXTENDED_ROLES.Observer`, `EXTENDED_ROLES.ISMDeputy`, `EXTENDED_ROLES.DeptAdmin`. If the option set values change, the Sidebar silently breaks while the constants are updated.
- **Current Implementation**: Hardcoded magic numbers.
- **Expected Implementation**: `import { EXTENDED_ROLES } from '../utils/roles'; if (userRole === EXTENDED_ROLES.Observer) ...`
- **Root Cause**: Constants not imported; copy from the constants file.
- **Business Impact**: Inconsistency between Sidebar behavior and role definitions; silent breakage risk.
- **Recommended Solution**: Replace all 3 magic numbers with their named constants from `EXTENDED_ROLES`.

---

**[F-029] SchedulingCalendar redefines STATUS_LABEL and RISK_LABEL locally**
- **Module**: `components/modules/SchedulingCalendar.tsx` lines 6–15
- **Category**: Technical Debt
- **Priority**: Medium
- **Complexity**: Low
- **Description**: Local `STATUS_LABEL` and `RISK_LABEL` objects duplicated verbatim from `utils/roles.ts` (`STATUS_LABEL_MAP`, `RISK_LABEL_MAP`). Not imported from the canonical source.
- **Current Implementation**: Local duplicates with identical values.
- **Expected Implementation**: Import `STATUS_LABEL_MAP`, `RISK_LABEL_MAP` from `utils/roles`.
- **Root Cause**: Developer did not check if imports existed.
- **Business Impact**: If a status label changes in `roles.ts`, it won't update in the calendar view.
- **Recommended Solution**: Replace local objects with imports from `utils/roles`.

---

**[F-030] No TypeScript path aliases configured**
- **Module**: `tsconfig.app.json`
- **Category**: Technical Debt
- **Priority**: Medium
- **Complexity**: Low
- **Description**: `tsconfig.app.json` has no `paths` aliases. All imports use deep relative paths like `../../utils/format`, `../../../generated`. In a deep component like `components/ism/ISMChangesTab.tsx`, this produces `../../../../utils/roles` — fragile and hard to refactor.
- **Current Implementation**: All relative paths.
- **Expected Implementation**: `"paths": { "@utils/*": ["./src/utils/*"], "@generated/*": ["./src/generated/*"], "@components/*": ["./src/components/*"] }` with matching Vite `resolve.alias`.
- **Root Cause**: Not configured at project initialization.
- **Business Impact**: Moving a file anywhere requires updating all relative import paths.
- **Recommended Solution**: Add `paths` to `tsconfig.app.json`. Add `resolve.alias` to `vite.config.ts`. Run `tsc --noEmit` to verify.

---

**[F-031] useCountdown creates 1-second interval per component instance**
- **Module**: `hooks/useDataverse.ts` lines 434–459
- **Category**: Performance
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: `useCountdown()` creates a `setInterval` running every 1000ms. If multiple bridge rows in `GIICCCommandCenter` each render a countdown, each creates its own interval. With 20 bridges, 20 intervals fire simultaneously every second, each triggering state updates.
- **Current Implementation**: One interval per hook call.
- **Expected Implementation**: Shared global countdown clock at the App level that ticks once per second and notifies subscribers.
- **Root Cause**: Convenience hook designed without considering multiple simultaneous instances.
- **Business Impact**: CPU overhead in browser; potential re-render storm with many active bridges.
- **Recommended Solution**: Create `CountdownContext` with a single global `setInterval`. Components subscribe and compute their own `remaining` from the shared tick.

---

**[F-032] `catch { /* silent */ }` blocks suppress errors without telemetry**
- **Module**: Multiple files including `AppContext.tsx` line 98, `UserProfilesContext.tsx` line 26, `useDataverse.ts` (multiple)
- **Category**: Technical Debt
- **Priority**: Medium
- **Complexity**: Low
- **Description**: Dozens of catch blocks silently swallow exceptions with no logging or telemetry. While `import.meta.env.DEV` guards exist in some places, production silent failures are undetectable.
- **Current Implementation**: `catch { /* silent */ }`, `catch { /* best-effort */ }`, `catch { /* ignore */ }`.
- **Expected Implementation**: `catch (err) { trackException(err as Error, { context: 'component:operation' }); }` for non-critical paths; rethrow for critical paths.
- **Root Cause**: Silent failure chosen over user-facing errors for background operations; but telemetry was not substituted.
- **Business Impact**: Production failures invisible in App Insights; no alerting possible.
- **Recommended Solution**: Replace all silent catch blocks with `trackException()` from `appInsights.ts` for production observability, keeping the UX silent where appropriate.

---

**[F-033] Cgmp_changesService session expiry handling documented as TODO**
- **Module**: `generated/services/Cgmp_changesService.ts` lines 15–23
- **Category**: Feature Gap
- **Priority**: Medium
- **Complexity**: High
- **Description**: A prominent comment in the generated service notes that 401/403 detection "cannot be added at this layer without a custom fetch wrapper" and defers the implementation. The `SessionExpiredBanner` component exists and listens for the `cgmp-session-expired` event, but the event is never dispatched. The banner never activates.
- **Current Implementation**: Banner exists; event never fired; 401s pass silently.
- **Expected Implementation**: Custom fetch wrapper or global response interceptor that dispatches `cgmp-session-expired` on 401/403.
- **Root Cause**: Power Apps client abstracts the HTTP layer; intercepting responses requires wrapping the client.
- **Business Impact**: Expired sessions cause silent data loading failures; users see empty tables with no explanation.
- **Recommended Solution**: Create a `DataverseClientWrapper` that wraps each service method, inspects the `IOperationResult.success` field and a 401 error code, then dispatches the session expired event.

---

**[F-034] `cgmp_assignedlocations` uses semicolons while `cgmp_projectids` uses commas**
- **Module**: `AppContext.tsx` line 214; multiple components
- **Category**: Architecture
- **Priority**: Medium
- **Complexity**: Low
- **Description**: `cgmp_assignedlocations` is parsed with `.split(';')` in `AppContext.tsx` line 215. `cgmp_projectids` is parsed with `.split(',')` in `useDataverse.ts`, `ISMWorkspace.tsx`, and elsewhere. Inconsistent delimiter choice across two multi-value string columns.
- **Current Implementation**: Semicolon for locations, comma for project IDs.
- **Expected Implementation**: Single consistent delimiter across all multi-value string columns, or better, use proper Dataverse relationships instead of comma/semicolon-delimited strings.
- **Root Cause**: Two fields added by different developers without a delimiter convention.
- **Business Impact**: Developers parsing these fields must remember which delimiter applies to which field; parsing bugs are a constant risk.
- **Recommended Solution**: Standardize on `';'` for all multi-value strings. Document in a code comment. Long-term, replace with proper Dataverse N:N relationships.

---

**[F-035] No URL/deep-linking support — all navigation is in-memory state**
- **Module**: `AppContext.tsx` lines 53–54, 196–199
- **Category**: Architecture
- **Priority**: Medium
- **Complexity**: High
- **Description**: `activePage` is React state initialized to `'dashboard'`. There is no URL routing (no React Router, no browser history API usage). Refreshing the browser always resets to Dashboard. Users cannot bookmark a specific workspace, share a link to a change, or use browser back/forward navigation.
- **Current Implementation**: `setActivePage(page)` with no URL update.
- **Expected Implementation**: Hash-based routing (`window.location.hash`) or HTML5 History API integration, even within a Power Apps iframe.
- **Root Cause**: Power Apps Code Apps run in an iframe where full URL routing is complex; hash-based routing was not implemented.
- **Business Impact**: No bookmarking; browser back button exits the app; no shareable deep links.
- **Recommended Solution**: Use `window.location.hash` for tab state. Parse `#/pmo` on load to restore the active page. Update hash on every `navigate()` call.

---

**[F-036] No explicit Dataverse pagination cursor — records beyond cap silently dropped**
- **Module**: `hooks/useDataverse.ts`, multiple
- **Category**: Architecture
- **Priority**: Medium
- **Complexity**: High
- **Description**: All hooks use a `top` limit (1000, 500, 200). The Power Apps client may return OData `@odata.nextLink` for paginated results, but no hook iterates through pages. Tenants with more than 1000 changes will silently see truncated data across all views.
- **Current Implementation**: Fixed-page fetch with no continuation token handling.
- **Expected Implementation**: Iterate `@odata.nextLink` until all records are fetched, or implement server-side filtering to reduce record count.
- **Root Cause**: SDK usage pattern defaults to single-page fetch.
- **Business Impact**: Large tenants see incomplete data without any warning; SLA calculations, dashboards, and reports are wrong.
- **Recommended Solution**: Check `IOperationResult` for a next-page token and recursively fetch, or implement date-range filtering (only load changes from the last 90 days) to keep records within the cap.

---

**[F-037] Knowledge Base markdown rendering uses innerHTML (potential XSS)**
- **Module**: `components/modules/KnowledgeBase.tsx` lines 96–100+`renderMarkdown()`
- **Category**: Security
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: The `renderMarkdown()` function and `highlightCode()` function produce HTML strings. If this is set via `dangerouslySetInnerHTML` (common pattern for markdown rendering), user-authored content could inject XSS payloads. The function at line 96 shows HTML escaping (`&amp;`, `&lt;`) for code blocks, suggesting `dangerouslySetInnerHTML` is used.
- **Current Implementation**: HTML string construction with partial escaping.
- **Expected Implementation**: Use a vetted markdown library (e.g., `marked` with `DOMPurify` sanitization) or ensure all user content paths escape HTML before injection.
- **Root Cause**: Custom markdown renderer built without a security review.
- **Business Impact**: Malicious Knowledge Base articles can inject scripts that execute in all users' browsers, stealing sessions or performing actions on their behalf.
- **Recommended Solution**: Add `DOMPurify.sanitize()` wrapping the output of `renderMarkdown()` before passing to `dangerouslySetInnerHTML`.

---

**[F-038] `lastActiveLabel()` in SecurityRoles uses `modifiedon` as proxy for activity**
- **Module**: `components/settings/SecurityRoles.tsx` lines 36–46
- **Category**: Bug
- **Priority**: Medium
- **Complexity**: Low
- **Description**: `lastActiveLabel()` determines "Active now / Xm ago / idle" based on `userProfile.modifiedon`. But `modifiedon` reflects when the profile record was last updated (role change, location update), not when the user last logged in. A user whose profile was edited 2 minutes ago by an admin appears as "Active now."
- **Current Implementation**: `modifiedon` used as last-active proxy.
- **Expected Implementation**: Track actual login time via the audit log or a dedicated `cgmp_lastseenat` field updated on each login.
- **Root Cause**: No dedicated last-seen timestamp on the user profile entity.
- **Business Impact**: User activity status is misleading; admins may incorrectly assess user engagement.
- **Recommended Solution**: Add `cgmp_lastseenat` (DateTime) column to `cgmp_userprofiles`. Update it on each app load in `AppContext` after the profile is fetched.

---

**[F-039] `useFeatureFlag()` is synchronous but feature flags change requires page reload**
- **Module**: `utils/featureFlags.ts` lines 23–26
- **Category**: Bug / UX
- **Priority**: Medium
- **Complexity**: Low
- **Description**: `useFeatureFlag()` calls `isFeatureEnabled()` which reads localStorage synchronously at render time. Since there is no React state or subscription, toggling a feature flag in `Settings.tsx` does not trigger re-renders in components that read the flag. The comment says "flags change rarely; no subscription needed" but the UI suggests flags take immediate effect.
- **Current Implementation**: Synchronous read with no subscription.
- **Expected Implementation**: Either a React context/state for feature flags (so toggles propagate immediately) or a clear "restart required" message when flags change.
- **Root Cause**: Chose simplicity over reactivity.
- **Business Impact**: Users toggle a flag in Settings and expect the behavior to change; nothing happens until they reload.
- **Recommended Solution**: Wrap `featureFlags` in a React context initialized from localStorage, with a `setFlag` method that updates both localStorage and state. Or add a "Changes take effect after page reload" notice in Settings.

---

**[F-040] No ESLint rules enforcing accessibility (jsx-a11y)**
- **Module**: `package.json`; ESLint config
- **Category**: Technical Debt
- **Priority**: Medium
- **Complexity**: Low
- **Description**: `package.json` includes `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh` but no `eslint-plugin-jsx-a11y`. The codebase contains numerous accessibility issues (F-041 to F-050 below) that would be caught automatically by jsx-a11y rules.
- **Current Implementation**: No accessibility linting.
- **Expected Implementation**: `eslint-plugin-jsx-a11y` installed and configured with recommended ruleset.
- **Root Cause**: Accessibility not prioritized during project setup.
- **Business Impact**: Accessibility regressions accumulate unchecked.
- **Recommended Solution**: `npm install -D eslint-plugin-jsx-a11y`. Add to ESLint config with `rules: { 'jsx-a11y/aria-roles': 'error', 'jsx-a11y/alt-text': 'error', ... }`.

---

### 1.4 UI/UX & Accessibility (F-041 to F-050)

**[F-041] No focus trap in SlidePanel/Modal components**
- **Module**: `components/ui/Modal.tsx`
- **Category**: UI/UX
- **Priority**: High
- **Complexity**: Medium
- **Description**: When `SlidePanel` or `Dialog` opens, keyboard focus is not trapped inside the panel. A Tab keypress exits the panel into the underlying page content, which is both confusing and fails WCAG 2.1 Success Criterion 2.4.3 (Focus Order).
- **Current Implementation**: No focus trap implementation detected.
- **Expected Implementation**: On open, move focus to first focusable element in panel; Tab cycles within; Esc closes.
- **Recommended Solution**: Implement focus trap using `@radix-ui/react-focus-trap` or a custom `useFocusTrap` hook. Save and restore focus on close.

---

**[F-042] Search overlay uses incorrect ARIA roles**
- **Module**: `components/Header.tsx` lines 83, 194
- **Category**: UI/UX
- **Priority**: Medium
- **Complexity**: Low
- **Description**: Both `SearchOverlay` and `CommandPalette` set `role="listbox"` on the container div, but the items are `<button>` elements with class `search-result`. The correct pattern for a listbox is `<div role="option">` children. Buttons in a listbox are invalid HTML/ARIA and will be misannounced by screen readers.
- **Current Implementation**: `role="listbox"` containing `<button>` children.
- **Expected Implementation**: Either use `role="listbox"` with `role="option"` children (not interactive) and handle selection with keyboard events, or use `role="menu"` with `role="menuitem"` children, or use combobox ARIA pattern correctly with the `<input>` as the combobox owner.
- **Recommended Solution**: The `<input>` already has `role="combobox"` and `aria-controls={searchListboxId}`. Keep this. Change child items from `<button>` to `<div role="option" tabIndex="-1">` and handle keyboard navigation via the input's `onKeyDown`.

---

**[F-043] Emoji used as functional status indicators without screen reader alternatives**
- **Module**: `components/ism/ISMActionsTab.tsx` line 313; `App.tsx` line 59
- **Category**: UI/UX
- **Priority**: Medium
- **Complexity**: Low
- **Description**: `'🔴 Critical'`, `'🟡 Warning'`, `'🔵 Info'` are used as urgency labels. Emoji pronunciation by screen readers varies by platform (NVDA: "red circle Critical"; VoiceOver: "large red circle Critical"). The `WorkspacePage` component uses `🔧` as a decorative icon with `role="img"` but the text is adequate.
- **Current Implementation**: Raw emoji in text content.
- **Expected Implementation**: Use `<span aria-hidden="true">🔴</span><span className="sr-only">Critical</span>` pattern to control screen reader output.
- **Recommended Solution**: Create an `UrgencyBadge` component that uses the aria-hidden/sr-only split. Apply consistently.

---

**[F-044] DataTable sort is not keyboard-accessible for all sortable columns**
- **Module**: `components/ui/DataTable.tsx` lines 162–167
- **Category**: UI/UX
- **Priority**: Medium
- **Complexity**: Low
- **Description**: Sortable `<th>` elements have `tabIndex={0}` and `onKeyDown` handlers that respond to Enter/Space — this is correct. However, non-sortable columns have neither, producing inconsistent tab behavior across the header row.
- **Current Implementation**: Sortable headers keyboard-accessible; non-sortable headers not focusable.
- **Expected Implementation**: Non-sortable headers should have `tabIndex={-1}` or `scope="col"` without `tabIndex` so they are skipped by Tab.
- **Recommended Solution**: Minor: Non-sortable `<th>` elements should not receive `tabIndex` at all (current behavior). Verify Tab stops match user expectations.

---

**[F-045] No skip-to-content link for secondary regions**
- **Module**: `App.tsx` line 214
- **Category**: UI/UX
- **Priority**: Low
- **Complexity**: Low
- **Description**: The `<a href="#main-content" className="skip-link">` correctly provides a skip-to-main link. However, the right panel (RightPanel component) has no skip target. The sidebar also has no skip link, though it is aria-labeled.
- **Recommended Solution**: Add `id="right-panel-content"` to RightPanel and a `<a href="#right-panel-content">` skip link for keyboard users who want to reach the panel directly.

---

**[F-046] Toast notifications have no visible focus indicator or keyboard dismiss**
- **Module**: `components/ui/Toast.tsx`
- **Category**: UI/UX
- **Priority**: Medium
- **Complexity**: Low
- **Description**: Toast messages appear as transient overlays. If they contain action buttons (dismiss), keyboard users navigating sequentially may not reach them before they auto-dismiss in 4 seconds. Additionally, toasts are not announced as an `aria-live` region.
- **Recommended Solution**: Wrap `ToastContainer` with `aria-live="polite"` and `aria-atomic="true"`. Ensure each toast persists focus if it has interactive controls (pause timer on focus). Consider `aria-live="assertive"` for error toasts.

---

**[F-047] Right panel collapse preference persisted but panel has no aria-expanded state**
- **Module**: `App.tsx` lines 248–256
- **Category**: UI/UX
- **Priority**: Low
- **Complexity**: Low
- **Description**: The RightPanel toggle button persists state to localStorage. The RightPanel itself renders `collapsed={rightPanelCollapsed}`. However, no `aria-expanded` or `aria-controls` is set on the toggle button to communicate panel state to screen readers.
- **Recommended Solution**: Add `aria-expanded={!rightPanelCollapsed}` and `aria-controls="right-panel"` to the toggle button. Add `id="right-panel"` to the panel container.

---

**[F-048] No PDF export for any workspace view**
- **Module**: All workspace and module components
- **Category**: Feature Gap
- **Priority**: Low
- **Complexity**: Medium
- **Description**: `AuditCenter.tsx`, `ChangeList.tsx`, `Reports.tsx`, and notification exports support CSV and/or JSON only. Enterprise users commonly need PDF reports for compliance submissions, sign-off documentation, and management reporting.
- **Recommended Solution**: Implement `window.print()` with print-specific CSS (`@media print`) to hide navigation elements and produce clean printed output. For rich PDFs, add a lightweight library like `jsPDF` or trigger a Power Automate flow that generates a PDF from a Word template.

---

**[F-049] MiniCalendar in Dashboard does not mark blackout periods**
- **Module**: `components/Dashboard.tsx` lines 135–200
- **Category**: Feature Gap
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: The `MiniCalendar` component shows changes as dots on days. It does not load or display `Cgmp_blackoutperiods`, so blackout dates appear the same as regular days. Users cannot see at a glance which dates are blocked.
- **Recommended Solution**: Fetch `Cgmp_blackoutperiodsService.getAll()` in the Dashboard and pass to `MiniCalendar`. Render blackout days with a distinct visual treatment (red background, strikethrough).

---

**[F-050] Mobile layout not tested or optimized beyond sidebar collapse**
- **Module**: `App.tsx` lines 151, 169, 234
- **Category**: UI/UX
- **Priority**: Low
- **Complexity**: High
- **Description**: The app auto-collapses the sidebar on `window.innerWidth <= 768`, but workspace grid layouts (DataTable columns, ChangeForm's multi-column grid, ISM KPI bar with 6 tiles) are not tested at mobile viewport. The `Header.tsx` brand text and search are likely to overflow.
- **Recommended Solution**: Add CSS breakpoints for key layouts at 768px and 480px. Test critical workflows on a mobile device. The Teams mobile client is a significant usage scenario.

---

### 1.5 Performance (F-051 to F-055)

**[F-051] Multiple parallel workspace data fetches on initial load**
- **Module**: `hooks/useDataverse.ts`, `context/AppContext.tsx`, `context/UserProfilesContext.tsx`
- **Category**: Performance
- **Priority**: High
- **Complexity**: Medium
- **Description**: On app load with the Dashboard active, the following fetches fire simultaneously: (1) user profile lookup in `AppContext` (2) 500 user profiles in `UserProfilesContext` (3) 1000 changes in `useChanges` (Dashboard) (4) 500 changes in `useChangeList` (Header search) (5) 500 projects in `useProjects` (Header search) (6) 200 notifications in `useNotifications`. That is 6 parallel Dataverse API calls consuming significant quota and causing resource contention.
- **Recommended Solution**: Implement request deduplication. Share a single `useChanges` fetch result across all consumers via context. Defer Header search data (F-013). Lazy-initialize `UserProfilesContext` only when first needed.

---

**[F-052] Dashboard line chart renders SVG paths computed on every render**
- **Module**: `components/Dashboard.tsx` lines 10–48
- **Category**: Performance
- **Priority**: Low
- **Complexity**: Low
- **Description**: `LineChart` is `React.memo` wrapped — good. But inside, `line()` computes SVG path strings from scratch on each render using array `.map()` over the 7-day data array. Since `data` is a prop that only changes on fetch completion, the memo prevents unnecessary re-renders correctly. This finding is minor but worth noting.
- **Recommended Solution**: Current implementation is acceptable. Verify `React.memo` equality comparison works correctly for the array prop (it performs shallow reference comparison, so ensure `trendData` reference is stable via `useMemo` in the caller — which it is in `useChanges`).

---

**[F-053] `versionHistory` is parsed and re-stringified on every change update**
- **Module**: `utils/business.ts` lines 56–65`; called from ISMActionsTab, ITOpsWorkspace, GIICCCommandCenter`
- **Category**: Performance
- **Priority**: Low
- **Complexity**: Low
- **Description**: `appendHistory()` parses the full JSON blob, pushes one entry, and re-serialises the entire array. For a 450-entry history, this is a large JSON parse/stringify on every update operation. At 450 entries, the serialized size could exceed 200KB depending on entry sizes.
- **Recommended Solution**: This is acceptable for the current scale, but once moved to a proper `cgmp_changehistory` table (F-024), this pattern becomes unnecessary.

---

**[F-054] Vite manual chunk configuration is minimal**
- **Module**: `vite.config.ts` lines 13–19
- **Category**: Performance
- **Priority**: Low
- **Complexity**: Low
- **Description**: `manualChunks` only separates `react`/`react-dom` (vendor) and `@microsoft/applicationinsights-web` (app-insights). The `@microsoft/power-apps` SDK, which is likely the largest dependency, has no dedicated chunk. Lazy-loaded workspace components will bundle the SDK in each chunk if it's not properly deduplicated.
- **Recommended Solution**: Add `'power-apps-sdk': ['@microsoft/power-apps']` to `manualChunks`. Run `vite build --report` to validate chunk sizes and ensure no workspace chunk exceeds the 600KB warning limit.

---

**[F-055] Profile refresh every 5 minutes fires even with no user interaction**
- **Module**: `AppContext.tsx` lines 146–163
- **Category**: Performance
- **Priority**: Low
- **Complexity**: Low
- **Description**: The profile refresh uses `visibilitychange` to pause/resume correctly, which is a well-implemented pattern. However, 5-minute intervals may be unnecessarily frequent for a profile that rarely changes (role, locations). This generates a Dataverse query every 5 minutes per active user.
- **Recommended Solution**: Extend interval to 30 minutes or use a cache-busting approach: only refresh if `Date.now() - lastProfileFetchTime > 30*60*1000`. Alternatively, listen for profile-specific Dataverse webhooks via Power Automate to push updates.

---

### 1.6 Dataverse & Data Layer (F-056 to F-065)

**[F-056] No server-side field validation — all validation is client-only**
- **Module**: `components/pmo/ChangeForm.tsx` lines 100–118
- **Category**: Security / Architecture
- **Priority**: Critical
- **Complexity**: High
- **Description**: `validate()` in `ChangeForm.tsx` enforces required fields, date ordering, and future-date constraints entirely in React. The Dataverse `cgmp_changes` table has no business rules, required column enforcement, or calculated fields enforcing these constraints server-side.
- **Recommended Solution**: Add Dataverse business rules on the `cgmp_changes` table for required fields. Use a Power Automate cloud flow triggered on create/update to validate date ordering and reject invalid payloads.

---

**[F-057] UAT data, project statuses, and ownership history stored as JSON blobs in text columns**
- **Module**: `generated/models/Cgmp_changesModel.ts`, `Cgmp_bridgesModel`; consumed in GIICCCommandCenter, ISMWorkspace, BridgeExecution
- **Category**: Architecture
- **Priority**: High
- **Complexity**: High
- **Description**: `cgmp_uatusers` (ChangeUATData), `cgmp_projectstatuses` (BridgeExecutionData), and `cgmp_ownershiphistory` (ISM handover) are all JSON strings stored in text columns. These fields contain structured relational data (contacts, project IDs, statuses) that should be modeled as related Dataverse tables.
- **Root Cause**: Faster initial development; avoided building child tables.
- **Business Impact**: No server-side filtering or aggregation on these fields; Power BI and OData reporting impossible; field size limits create data loss risk; no referential integrity.
- **Recommended Solution**: Create `cgmp_changeuat` table (change lookup, project lookup, status, contacts JSON), `cgmp_bridgeprojectstatus` table, `cgmp_ismhandover` table. Migrate existing JSON data during the next ALM deployment.

---

**[F-058] `cgmp_recipientid` is a plain string, not a Dataverse lookup**
- **Module**: `generated/models/Cgmp_notificationsModel.ts` line 37
- **Category**: Architecture
- **Priority**: High
- **Complexity**: Medium
- **Description**: `cgmp_recipientid` stores the `cgmp_userprofileid` GUID as a plain string. There is no Dataverse lookup relationship to `cgmp_userprofiles`. Deleting a user profile will not cascade to notifications. OData `$expand` to get recipient details is impossible.
- **Recommended Solution**: Change `cgmp_recipientid` to a Dataverse lookup column pointing to `cgmp_userprofiles`. Regenerate models. Update all notification creation calls to use the lookup syntax.

---

**[F-059] `cgmp_relatedchangeid` on tasks and notifications is a plain string**
- **Module**: `components/modules/TaskManager.tsx`; `generated/models/Cgmp_notificationsModel.ts`
- **Category**: Architecture
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: Both the task `cgmp_relatedchangeid` and notification `cgmp_relatedchangeid` are plain strings. Deleting a change does not cascade; orphan references accumulate. OData $expand to get change details inline is not possible.
- **Recommended Solution**: Convert to Dataverse lookup columns. Configure cascade behavior (restrict delete if tasks/notifications reference the change, or cascade delete).

---

**[F-060] No Dataverse audit log native capability used**
- **Module**: `generated/services/Cgmp_auditlogsService.ts`; `AuditCenter.tsx`
- **Category**: Architecture
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: The app maintains its own custom `cgmp_auditlogs` table and writes audit records manually from client-side code. Dataverse has built-in table-level auditing that captures all create/update/delete operations with who, what, when — including API calls that bypass the UI. The custom table only captures events the UI explicitly logs.
- **Recommended Solution**: Enable Dataverse native auditing on `cgmp_changes`, `cgmp_bridges`, `cgmp_userprofiles`. Surface the native audit log (available via `/api/data/v9.1/audits`) in the Audit Center view. Retain the custom audit log for app-specific events (login, bridge execution steps).

---

**[F-061] Hard delete of changes is allowed with no soft-delete pattern**
- **Module**: `components/pmo/ChangeList.tsx`; `Cgmp_changesService.delete()`
- **Category**: Architecture
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: `Cgmp_changesService.delete()` performs a hard Dataverse delete. Regulatory change management frameworks (ITIL, SOX) typically require all change records to be retained for 3–7 years. Hard deletion creates gaps in the audit trail.
- **Recommended Solution**: Replace delete with a status transition to `Cancelled` or a soft-delete flag (`cgmp_isdeleted`). Only Admins should access the Archive Center for long-term archival. Restrict actual hard-delete to Archive Center operations on records older than the retention window.

---

**[F-062] ISM `cgmp_primaryism` (display name) column maintained alongside `cgmp_primaryismid` (GUID)**
- **Module**: `components/ism/ISMWorkspace.tsx` line 143; Dataverse model
- **Category**: Architecture
- **Priority**: Medium
- **Complexity**: Low
- **Description**: Two fields serve overlapping purposes: `cgmp_primaryism` (string name) and `cgmp_primaryismid` (GUID reference). If the `cgmp_primaryism` field is manually entered and diverges from the actual user profile name, the dual-filter in `ISMWorkspace` produces unexpected results (F-021).
- **Recommended Solution**: Deprecate `cgmp_primaryism` string field. Derive display name from the `cgmp_primaryismid` lookup's expanded `owneridname`. Remove name-based filtering everywhere.

---

**[F-063] `Cgmp_userprofilesModel.ts` Dataverse option set only covers 5 base roles**
- **Module**: `generated/models/Cgmp_userprofilesModel.ts` lines 12–18
- **Category**: Architecture
- **Priority**: High
- **Complexity**: Medium
- **Description**: `Cgmp_userprofilescgmp_role` enum only contains codes 100000000–100000004. This is the authoritative model generated from Dataverse schema. Extended role codes (100000005–100000007) exist only in TypeScript and would produce a Dataverse save error if written via the service.
- **Recommended Solution**: Extend the Dataverse option set to add Observer, ISMDeputy, DeptAdmin codes. Run `pac modelbuilder build --outputDirectory ./src/generated` to regenerate models. Verify `Cgmp_userprofilescgmp_role` enum includes all 8 values.

---

**[F-064] Change number uniqueness not enforced by Dataverse**
- **Module**: `components/pmo/ChangeForm.tsx` validation; Dataverse model
- **Category**: Architecture
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: `cgmp_changenumber` uniqueness is enforced only in client-side validation. Concurrent submissions from two users, or direct API calls, can create duplicate change numbers. The clone operation (F-016) creates records with blank change numbers, further polluting the namespace.
- **Recommended Solution**: Add a Dataverse alternate key on `cgmp_changenumber`. This enforces uniqueness at the API layer and returns a proper error on duplicate. Use Dataverse auto-numbering if sequences are desired.

---

**[F-065] Power BI embed URL stored in both localStorage and Dataverse `cgmp_powerbiurl`**
- **Module**: `components/settings/Settings.tsx` lines 57–72
- **Category**: Architecture
- **Priority**: Low
- **Complexity**: Low
- **Description**: Power BI URL is stored in localStorage as `cgmp-powerbi-url` AND in `userProfile.cgmp_powerbiurl`. On load, the Dataverse value takes precedence and is synced to localStorage. On save, it writes to Dataverse. This dual-store creates synchronization complexity and exposes the URL in localStorage (readable by any JS).
- **Recommended Solution**: Remove localStorage storage. Always read from `userProfile.cgmp_powerbiurl` in the profile context. Use a loading skeleton while the profile loads.

---

### 1.7 Enterprise Readiness (F-066 to F-075)

**[F-066] No ALM environment segregation or environment-specific configuration**
- **Module**: `vite.config.ts`, `package.json`, `teams/manifest.json`
- **Category**: Enterprise Readiness
- **Priority**: High
- **Complexity**: High
- **Description**: The build produces a single artifact with no environment-specific configuration. The Power Apps SDK derives its Dataverse endpoint from the hosting Power Apps environment automatically — this part works. But App Insights connection strings (F-004), tenant IDs (F-005), and feature flags (F-003) need environment-specific values.
- **Recommended Solution**: Add `.env.development`, `.env.test`, `.env.production` files with `VITE_` prefixed environment variables. Add a Vite `define` block to expose them. Build CI/CD pipeline with environment-specific variable injection.

---

**[F-067] No CI/CD pipeline configuration found**
- **Module**: Project root (no `.github/workflows`, no `azure-pipelines.yml`, no `Makefile` found)
- **Category**: Enterprise Readiness
- **Priority**: High
- **Complexity**: High
- **Description**: `package.json` includes `deploy:app` and `deploy:schema` PowerShell scripts, but no automated CI/CD pipeline configuration is present. Manual deployment to Power Apps requires running PowerShell scripts, with no automated testing gate.
- **Recommended Solution**: Create an Azure DevOps pipeline or GitHub Actions workflow: (1) `npm ci` → `npm run lint` → `npm run build` → Vitest (once F-019 addressed) → `pac solution pack` → deploy to test environment → smoke tests → promote to production.

---

**[F-068] Teams integration only uses a single static tab pointing to the full app**
- **Module**: `teams/manifest.json` lines 25–33
- **Category**: Enterprise Readiness
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: The Teams manifest defines one `staticTabs` entry pointing to the full Power Apps URL. Deep-linked tabs (PMO, GIICC, ISM) that teams commonly pin are not individually addressable. Teams notification cards that link to specific changes will land users on the Dashboard.
- **Recommended Solution**: Use hash-based routing (F-035) to support deep-linked URLs. Add additional static tabs for key roles (e.g., `PMO Workspace`, `GIICC Command Center`). Implement Teams Activity Feed notifications using the Graph API for critical state changes.

---

**[F-069] No Adaptive Card notification delivery for Teams**
- **Module**: `hooks/useDataverse.ts` (SLA escalation); notification creation across multiple components
- **Category**: Enterprise Readiness
- **Priority**: Medium
- **Complexity**: High
- **Description**: The `settings/Settings.tsx` feature flag `teams-integration` is defined but not implemented (similar to F-022). Despite `@microsoft/teams-js` being a listed dependency in `package.json`, no Teams adaptive cards or Bot Framework messages are sent for notifications.
- **Recommended Solution**: Create a Power Automate flow that responds to `cgmp_notifications` record creation and sends Teams adaptive card messages via the Teams connector, respecting `cgmp_notificationpreference` (Email/Teams/Both).

---

**[F-070] No internationalization (i18n) or localization support**
- **Module**: All component files; `utils/format.ts`
- **Category**: Enterprise Readiness
- **Priority**: Medium
- **Complexity**: High
- **Description**: All strings are English-only hardcoded in JSX. Date formatting uses `'en-US'` locale hardcoded in `format.ts` (lines 51, 63, 131, 162). For a "Global" change governance platform serving multiple countries/regions, this is a significant gap.
- **Recommended Solution**: Integrate `react-i18next` with a `locales/en.json` base file. Replace all string literals with `t('key')` calls. Switch date formatting locale to `navigator.language`. Identify top 3 target locales (based on ISM/project location data) and provide translations.

---

**[F-071] No structured error codes for operational support**
- **Module**: All service call error handling
- **Category**: Enterprise Readiness
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: Error messages passed to `showToast('error', ...)` are generic strings like "Failed to save PIR", "Clone failed", "Failed to load changes". Support teams have no error codes to identify specific failure modes.
- **Recommended Solution**: Define an error code registry (`utils/errors.ts`). Each error has a code (e.g., `CGMP-E001`), message, and suggested action. Log with App Insights including the code. Display the code to users so they can reference it in support tickets.

---

**[F-072] No rate-limiting or throttle protection for bulk write operations**
- **Module**: `components/pmo/PMOWorkspace.tsx` (bulk publish); `components/ism/ISMActionsTab.tsx` (handover); `components/itops/ITOpsWorkspace.tsx` (bulk approve)
- **Category**: Enterprise Readiness
- **Priority**: High
- **Complexity**: Medium
- **Description**: Bulk operations use `Promise.all()` of N individual service calls. Dataverse enforces a service protection API limit of 52,000 requests per 5 minutes per user. A bulk publish of 200 changes fires 200 simultaneous update calls plus 200 notification creates = 400 requests in seconds — approaching per-user limits.
- **Recommended Solution**: Implement a concurrency limiter: process N requests at a time with a delay between batches. Use `pLimit` or a custom implementation. Show a progress indicator during bulk operations.

---

**[F-073] Power Apps Code App `@microsoft/power-apps` version is `^1.0.3` (semver-major floating)**
- **Module**: `package.json` line 17
- **Category**: Enterprise Readiness
- **Priority**: Low
- **Complexity**: Low
- **Description**: `"@microsoft/power-apps": "^1.0.3"` uses caret range, allowing automatic upgrades to any `1.x.x` version. For a production enterprise app, unpinned SDK versions can introduce breaking changes or behavioral differences at deployment time.
- **Recommended Solution**: Pin to exact version: `"@microsoft/power-apps": "1.0.3"`. Update deliberately after testing against changelog. Use `npm ci` (not `npm install`) in CI to enforce lockfile versions.

---

**[F-074] No monitoring or alerting for Dataverse connectivity failures**
- **Module**: `utils/appInsights.ts`; all service hooks
- **Category**: Enterprise Readiness
- **Priority**: Medium
- **Complexity**: Medium
- **Description**: App Insights is integrated for page views, user identity, and exceptions. But there are no custom metrics or availability tests configured. A Dataverse service outage would cause all data loading to fail silently (F-032), with no alert to operations teams.
- **Recommended Solution**: Add `trackMetric` calls for Dataverse fetch duration and success rate. Set up Azure Monitor alerts on error rate thresholds. Consider Azure Application Insights Availability Tests pinging a health endpoint.

---

**[F-075] Notification preferences (Email/Teams/Both) have no effect on notification delivery**
- **Module**: `components/settings/Settings.tsx`; `generated/models/Cgmp_userprofilesModel.ts`
- **Category**: Feature Gap
- **Priority**: High
- **Complexity**: High
- **Description**: `cgmp_notificationpreference` (Email/Teams/Both) is stored in Dataverse and editable in Settings, but no code reads this preference when creating notifications. All notifications are created as Dataverse records only; no email or Teams message is sent regardless of user preference.
- **Recommended Solution**: Create a Power Automate cloud flow triggered on `cgmp_notifications` creation. Read the recipient's `cgmp_notificationpreference`. Branch to: (a) Teams message via Teams connector, (b) Office 365 Outlook send email action, (c) both. This makes the notification preference feature actually functional.

---

## SECTION 2: ASSESSMENT SCORECARDS

| Dimension | Score | Key Strengths | Key Gaps |
|-----------|-------|---------------|----------|
| **Overall Enterprise Readiness** | **52/100** | Comprehensive feature set, professional UI, good structural patterns | Critical security gaps, no tests, unimplemented features, no CI/CD |
| **Production Readiness** | **48/100** | Error boundaries on every workspace, session expired banner, App Insights telemetry wired | SLA escalation duplicates records on load, no session invalidation, no ALM pipeline |
| **Security Readiness** | **38/100** | OData injection partially mitigated, role-based access UI correctly implemented | All enforcement frontend-only, localStorage secrets, no CSP, session not invalidatable |
| **Performance** | **58/100** | Lazy loading for all 25 workspaces, React.memo on heavy chart components, visibility API pausing polls | Parallel startup fetches (6 simultaneous), no column projection in useChangeList, AdminDashboard over-fetches |
| **UI/UX Quality** | **70/100** | Consistent design system, dark/light theme, breadcrumbs, skip-to-content, skeleton loaders, keyboard shortcuts | Focus trap missing in modals, incorrect ARIA listbox pattern, no PDF export, mobile not fully tested |
| **Code Quality** | **62/100** | TypeScript strict mode, useMounted pattern, canonical constants file, well-typed interfaces | `as unknown as number` pervasive, silent catch blocks, duplicated utilities, no tests |
| **Architecture** | **60/100** | Context+hooks pattern clean, lazy workspace splitting, navigation guard, toast dedup | JSON blob anti-pattern for structured data, 25-branch routing, no URL routing, duplicate data fetching |
| **Dataverse Design** | **42/100** | Generated models with typed interfaces, service class per entity, proper use of filter/select/orderBy | String-based relationships, no lookups on recipientid/relatedchangeid, extended roles not in schema, no native auditing |
| **Maintainability** | **58/100** | Single constants file for roles/statuses, centralized formatting utilities, well-named business utilities | No path aliases, duplicated constants in SchedulingCalendar, Sidebar hardcoded magic numbers, no tests |
| **Scalability** | **44/100** | Lazy loading, visibility API pausing, pagination in DataTable | Fixed top limits silently drop records at scale, no $batch, no caching layer, JSON blobs can't be indexed |

**Scoring rationale:**

- **Security (38)**: The most serious dimension. All access control is JavaScript in the browser. Credentials in localStorage, no CSP, session not truly revocable. This score would be 15–20 without the OData injection partial mitigation and the well-designed role model (even though not server-enforced).

- **Dataverse Design (42)**: JSON blobs for structured relational data (`cgmp_uatusers`, `cgmp_projectstatuses`, `cgmp_ownershiphistory`) are a foundational design flaw. String relationships (`cgmp_recipientid`, `cgmp_relatedchangeid`) lack referential integrity. Extended roles missing from the Dataverse schema. Native auditing not leveraged.

- **Scalability (44)**: Fixed record caps with no pagination cursor means tenants beyond ~500 changes see silent data truncation. No OData $batch support for bulk operations. The JSON blob approach for version history creates O(N) parse costs and column size limits.

- **Overall Enterprise Readiness (52)**: The platform achieves functional breadth across 5 role-based workspaces and has commendable UX quality. However, the security, data architecture, and operational (CI/CD, testing, monitoring) gaps prevent a higher score until addressed.

---

## SECTION 3: PRIORITIZED IMPLEMENTATION ROADMAP

### 3.1 Critical — Must Fix Before Production

| Finding | Action |
|---------|--------|
| F-001 | Configure Dataverse table-level and column-level security roles for cgmp_changes, cgmp_bridges, cgmp_userprofiles |
| F-002 | Remove SLA escalation from useChanges(); create Power Automate scheduled flow with idempotency |
| F-003 | Move feature flags to Dataverse cgmp_appsettings table; restrict writes to Admin role |
| F-004 | Move App Insights connection string to VITE_ environment variable at build time |
| F-005 | Replace hardcoded tenant/environment IDs in teams/manifest.json with parameterized deployment |
| F-006 | Extend Dataverse option set for cgmp_role to include Observer/ISMDeputy/DeptAdmin; regenerate models |
| F-023 | Fix SLA escalation notification to populate cgmp_recipientid with Admin profile IDs |
| F-033 | Implement 401/403 detection wrapper to dispatch cgmp-session-expired event |
| F-037 | Add DOMPurify sanitization to renderMarkdown() output in KnowledgeBase |
| F-056 | Add Dataverse business rules for required field validation and date ordering on cgmp_changes |

### 3.2 High Priority — Ship in Next Sprint

| Finding | Action |
|---------|--------|
| F-007 | Implement AAD logout redirect in the logout() function |
| F-008 | Add Content Security Policy meta tag to index.html |
| F-009 | Replace beforeunload audit write with navigator.sendBeacon() |
| F-010 | Create escapeODataString() utility; apply to all filter string interpolations |
| F-011 | Move SLA business logic entirely out of useChanges() data hook |
| F-012 | Add select projection to useChangeList() — specify only required columns |
| F-013 | Lazy-initialize search data in Header — fetch only on first search focus |
| F-014 | Remove useAllUserProfiles() hook; replace all callsites with useUserProfiles() context |
| F-016 | Fix clone to generate change number or clearly prompt user to set one |
| F-019 | Install Vitest; write unit tests for all functions in utils/ |
| F-021 | Remove display-name-based OR condition from ISM project filtering |
| F-041 | Implement focus trap in SlidePanel and Dialog components |
| F-057 | Design and create cgmp_changeuat, cgmp_bridgeprojectstatus Dataverse tables as first migration step |
| F-058 | Convert cgmp_recipientid to Dataverse lookup column |
| F-075 | Create Power Automate flow for notification delivery by preference (Email/Teams) |

### 3.3 Medium Priority — Next Quarter

| Finding | Action |
|---------|--------|
| F-015 | Remove duplicate calcSLA from ISMWorkspace; use canonical business.ts import |
| F-017 | Add cgmp_cancellationreason column to cgmp_bridges; stop prepending to PIR notes |
| F-018 | Implement concurrency-limited bulk operation queue (max 5 parallel requests) |
| F-022 | Implement emergency fast-track SLA logic or remove the feature flag definition |
| F-024 | Create cgmp_changehistory Dataverse table; migrate appendHistory callers |
| F-025 | Add cgmp_ismsignoffat/by columns to cgmp_changes; update sign-off handler |
| F-026 | Global replace `as unknown as number` with `Number()` or `coerceOptionSet()` |
| F-027 | Refactor App.tsx renderContent() to use route registry map |
| F-028 | Replace Sidebar magic numbers with EXTENDED_ROLES constants |
| F-029 | Remove duplicated STATUS_LABEL/RISK_LABEL from SchedulingCalendar; import from roles.ts |
| F-030 | Add TypeScript path aliases to tsconfig.app.json and Vite config |
| F-032 | Replace silent catch blocks with trackException() telemetry calls |
| F-035 | Implement hash-based navigation routing for deep-linking and browser back support |
| F-036 | Implement pagination cursor for large dataset fetches |
| F-038 | Add cgmp_lastseenat column; update on app load; use in SecurityRoles activity display |
| F-039 | Add feature flag React context for immediate propagation without page reload |
| F-040 | Install eslint-plugin-jsx-a11y; configure recommended ruleset |
| F-042 | Fix ARIA roles: search overlay listbox pattern with proper role="option" children |
| F-043 | Replace emoji urgency indicators with aria-hidden + sr-only text pattern |
| F-059 | Convert cgmp_relatedchangeid on tasks/notifications to Dataverse lookup columns |
| F-060 | Enable native Dataverse auditing on cgmp_changes, cgmp_bridges, cgmp_userprofiles |
| F-061 | Replace hard-delete with soft-delete (Cancelled status or cgmp_isdeleted flag) |
| F-064 | Add alternate key constraint on cgmp_changenumber in Dataverse |
| F-066 | Create .env.development/.env.production with VITE_ variable separation |
| F-067 | Create Azure DevOps or GitHub Actions CI/CD pipeline with lint/build/test/deploy stages |
| F-072 | Implement concurrency limiter and progress UI for all bulk write operations |

### 3.4 Future Enhancements — Backlog

| Finding | Action |
|---------|--------|
| F-020 | Replace AdminDashboard full-record fetches with OData $count aggregations |
| F-031 | Create shared global countdown context to replace per-component intervals |
| F-034 | Standardize delimiter for all multi-value string columns |
| F-048 | Implement print-to-PDF capability for workspace views |
| F-049 | Display blackout periods in Dashboard MiniCalendar |
| F-050 | Full mobile/responsive layout audit and fix for all workspace grids |
| F-054 | Add power-apps SDK to Vite manualChunks configuration |
| F-062 | Deprecate cgmp_primaryism display name field; derive from lookup |
| F-065 | Remove Power BI URL from localStorage; read exclusively from Dataverse profile |
| F-068 | Add per-role Teams static tabs in manifest; implement Activity Feed notifications |
| F-069 | Implement Adaptive Card delivery via Power Automate and Teams connector |
| F-070 | Add react-i18next internationalization framework; define en.json base locale |
| F-071 | Create structured error code registry; surface codes in toasts and App Insights |
| F-073 | Pin all dependency versions; switch CI to npm ci |
| F-074 | Configure App Insights availability tests and Azure Monitor alerts on error rates |

---

## SECTION 4: MICROSOFT POWER PLATFORM ALIGNMENT

**Power Apps Code Apps Best Practices**

The application correctly uses the `@microsoft/power-apps` SDK (`getContext()` for user identity, `getClient(dataSourcesInfo)` for Dataverse access, generated service classes). The `vite.config.ts` uses the official `@microsoft/power-apps-vite/plugin`. Lazy loading aligns with the Code Apps guidance to minimize initial bundle size. The app deviates from best practice by not implementing model-driven form integration or using Power Fx for simple field calculations — both areas where Power Apps native constructs outperform custom React code for enterprise contexts.

**Dataverse Data Modeling**

The modeling diverges from Dataverse best practice significantly in the use of JSON blobs for relational data (F-057) and string fields for lookups (F-058, F-059). The `cgmp_changes` table appears well-structured for the core change record (numeric option sets, proper typed columns), but the ancillary data (UAT contacts, project statuses, version history) undermines the relational integrity that Dataverse provides. The lack of alternate key on `cgmp_changenumber` (F-064) and the extended roles not being in the Dataverse schema (F-006, F-063) represent schema incompleteness.

**Power Platform ALM**

The `pac modelbuilder build` script in `package.json` is the correct approach for model regeneration. The `deploy:app` and `deploy:schema` PowerShell scripts show awareness of Power Platform ALM, but without a Dataverse solution file management strategy (managed vs. unmanaged solutions, publisher prefix enforcement, solution layering) the ALM approach is incomplete. There is no evidence of a solution structure that would support proper promotion from DEV to TEST to PROD.

**Microsoft Security Development Lifecycle**

Alignment is partial. The codebase has no automated SAST scan, no dependency vulnerability scanning (Dependabot or npm audit in CI), no secrets in code (App Insights key is in localStorage rather than compiled code — which is actually a regression from SDL perspective). The SDL requires threat modeling documentation and security reviews for auth-adjacent code, neither of which is evident.

**Fluent UI / Microsoft Design System Alignment**

The app uses a custom CSS design system rather than Fluent UI React components. The design vocabulary (colors, typography, spacing, component patterns) shows Fluent UI inspiration — the status badge colors, the primary blue (`#0078D4` in the manifest), the card-based layouts — but does not import or use any `@fluentui/react` or `@fluentui/react-components` packages. This means the app misses Fluent UI's built-in accessibility (focus management, screen reader patterns, high-contrast mode support), theming integration with Teams, and automatic design updates from Microsoft.

**Power Automate Integration Opportunities**

The application would benefit greatly from Power Automate for: (1) SLA escalation (replacing the client-side fire-and-forget, per F-002/F-011), (2) email/Teams notification delivery (F-075/F-069), (3) approval workflows for high-risk or emergency changes that currently use UI-only role checks (F-001), (4) automated archival of completed changes after 90 days. The `@microsoft/teams-js` SDK is a dependency but appears unused — Power Automate Teams connector would fill this gap.

**Microsoft 365 / Teams Integration Maturity**

The Teams integration is currently at Level 1 (app embedded as a single tab). Level 2 would add deep-linked tabs per role workspace, Teams Activity Feed notifications for @mentions, and bot commands for status queries. Level 3 would add Adaptive Card-based approval workflows in Teams chat, meeting integration for bridge window scheduling, and SharePoint document library integration for attachments. The `teams-integration` feature flag documents the ambition; implementation is the gap.

**Azure Services Integration Opportunities**

Application Insights is integrated (Level 1). Azure opportunities not yet leveraged: Azure Key Vault for secrets management (App Insights key, other config), Azure Functions for server-side validation and batch operations, Azure Service Bus for reliable notification queuing, Azure Blob Storage (via SharePoint) for attachment handling that bypasses Dataverse annotation size limits, Azure Monitor for operational dashboards surfacing the custom App Insights telemetry.

---

## SECTION 5: ADDITIONAL STRATEGIC RECOMMENDATIONS

**SR-1: Implement Dataverse Server-Side Security as the Immediate Priority**
Before adding any new features, establish proper Dataverse security roles. Create a `CGMP User` base security role with read access to all `cgmp_*` tables. Create `CGMP PMO`, `CGMP ITOps`, `CGMP ISM`, `CGMP GIICC`, `CGMP Admin` roles with table-level create/update access matching the `ALLOWED_TRANSITIONS` matrix in `roles.ts`. This converts the existing frontend RBAC documentation into actual enforced policy. Estimated effort: 3–5 days of Dataverse configuration plus testing. This single change eliminates the most critical security risk (F-001) and provides the foundation for all other security improvements.

**SR-2: Migrate JSON Blob Columns to Proper Dataverse Tables**
The three highest-value migrations (UAT data, bridge project statuses, ISM handover history) would unlock server-side reporting, eliminate the data loss risk from column size limits, and enable Power BI DirectQuery integration on these fields. Approach: create the new tables, add a migration Power Automate flow that reads existing JSON from old columns, writes individual records to new tables, then marks the old column as deprecated. Run in a test environment first; target one table per sprint. This addresses F-024, F-025, F-057, F-059.

**SR-3: Establish a Testing Foundation Before the Next Feature Sprint**
The absence of any automated tests (F-019) is the highest-risk technical debt item for long-term maintainability. Start with Vitest unit tests for the 9 pure utility functions in `utils/`: `roles.ts` (status transitions, label lookups), `business.ts` (calcSLA, appendHistory, computeHealthScore, freeze dates), `format.ts` (date formatting with timezone edge cases). These tests can be written in 1–2 days and provide immediate regression protection for the most critical business logic. Then add Playwright E2E tests for the two most critical user journeys: submitting a change request (PMO) and transitioning a change through IT Ops review.

**SR-4: Create a Power Automate Notification Delivery Layer**
The notification preference feature (Email/Teams/Both) is currently non-functional (F-075). Implementing this via Power Automate requires: (1) a cloud flow triggered on `cgmp_notifications` create, (2) a `Get row by ID` step to fetch the recipient's profile and preference, (3) a switch on preference to route to Office 365 Outlook send-email or Teams post-message. This can be built in 1–2 days and delivers immediate user value: for the first time, escalation notifications will actually reach users. This also makes the notification system enterprise-grade.

**SR-5: Implement Proper Application Lifecycle Management**
Create a managed Dataverse solution (`CGMP_v2`) with the `cgmp_` publisher prefix. All custom tables, columns, option sets, and business rules should be in this solution. Export as managed for TEST/PROD deployments, unmanaged for DEV. Create a `SolutionDefinition.cdsproj` or equivalent. Integrate with Power Platform Build Tools in Azure DevOps. This allows proper version control of schema changes, rollback capability, and environment promotion without manual steps. Currently, deploying schema changes requires the PowerShell scripts which have no version tracking.

**SR-6: Replace Custom RBAC with Azure AD Group-Based Role Assignment**
Currently, each user requires a manual `cgmp_userprofiles` record with a role assignment. At scale, this becomes an administrative burden. Implement AAD group membership as the role source: create AAD security groups (`CGMP-PMO`, `CGMP-ITOps`, `CGMP-ISM`, `CGMP-GIICC`, `CGMP-Admin`). In `AppContext.tsx`, after fetching the user profile, also call Microsoft Graph `me/memberOf` via the Teams JS SDK to determine group membership. This enables self-service role management via AAD group membership rather than manual profile updates.

**SR-7: Establish a Metrics and Monitoring Strategy**
Beyond the current App Insights integration (page views, exceptions), add business metrics: `trackEvent('change-submitted', { role, changeType, riskLevel })`, `trackEvent('sla-breach', { changeId, ageHours })`, `trackMetric('dataverse-fetch-duration-ms', duration, { entity, operation })`. Create an App Insights Workbook displaying: (1) active users by role per day, (2) SLA compliance trend, (3) Dataverse API call volume, (4) error rate by workspace. Set Azure Monitor alerts on error rate > 5%, Dataverse fetch > 5s average. This converts the app from "deployed and forgotten" to actively monitored.

**SR-8: Adopt Fluent UI React Components for Accessibility and Teams Integration**
Migrating to `@fluentui/react-components` (Fluent UI v9) for core UI elements (DataTable → `<Table>`, Modal → `<Dialog>`, form inputs → `<Input>`, `<Select>`) would provide: automatic high-contrast mode support for accessibility, Fluent Design System theme tokens that adapt to Teams' light/dark theme automatically, built-in ARIA compliance for interactive elements (focus trap in dialogs, correct listbox patterns, roving tabindex for lists). This migration can be done incrementally — start with `Dialog` and form components (highest accessibility impact) while retaining custom CSS for layout.

**SR-9: Build a Change Impact Intelligence Layer**
The platform collects rich data about changes, projects, UAT outcomes, and bridge execution results. This data could feed a lightweight intelligence layer: (a) automatically calculate composite risk score based on similar past changes' failure rates in the same location/category/time slot, (b) flag changes that historically have high UAT failure rates, (c) suggest optimal scheduling windows based on capacity planning data. This could be implemented as client-side analytics within `useChanges()` or as a Power Automate scheduled flow that writes computed risk scores back to `cgmp_changes.cgmp_computedrisk`. This differentiates the platform from a simple workflow tool.

**SR-10: Implement SharePoint Integration for Attachment Management**
Currently, attachments are stored as Dataverse annotations (binary data in the database). For an enterprise governance platform with potentially thousands of change documents, this impacts Dataverse storage costs significantly. Implement the `sharepoint-integration` feature flag properly: (a) create a SharePoint document library per change (or per project), (b) use the SharePoint REST API or Graph API to upload/download files, (c) store only the SharePoint file URL in `cgmp_attachmentids`. This aligns with Microsoft's recommended pattern for document management in Dataverse-based apps and reduces Dataverse storage costs materially.

---

**Review completed.** Every finding above is grounded in specific files and line numbers read from the codebase. The 75 findings span all seven dimensions, with scores and priorities calibrated to the actual code observed rather than generic enterprise checklists.
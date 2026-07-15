# Enterprise Review — Global Change Governance & Impact Management Platform

**Review Date:** 2026-07-11
**Stack:** React 19 · TypeScript 5.9 · Vite 7 · Power Apps Code App · Dataverse
**Reviewer:** Enterprise Architecture Review Board
**Codebase Version:** 2.0.0
**Review Scope:** Full source audit — 75+ files read across all workspaces, services, models, contexts, and utilities

---

## Section 1 — Executive Summary

The Global Change Governance & Impact Management Platform (CGMP) is a Power Apps Code App built on a modern React 19 / TypeScript 5.9 / Vite 7 stack deployed within the Microsoft Power Platform ecosystem. The application covers a sophisticated multi-role change lifecycle from initial PMO creation through ITOps technical review, ISM project oversight, and GIICC command-centre execution, with dedicated bridge scheduling, PIR capture, notification management, audit logging, and an extensible administrative layer. The architectural foundation is sound: the stack choice is appropriate for a Power Platform-embedded enterprise app, lazy-loaded workspaces reduce initial bundle size, a well-defined RBAC model covers eight distinct roles, and the generated Dataverse service layer provides type-safe CRUD operations. Client-side state is thoughtfully partitioned across three React contexts, and the codebase shows evidence of iterative refinement — duplicate data-fetching patterns have been addressed, magic numbers centralised into constants, and accessibility primitives (skip links, ARIA landmarks, role attributes) are in place across the shell.

At the same time, the platform carries a cluster of issues that collectively represent a material gap between current state and enterprise production readiness. The most critical cluster is security: a production Azure AD tenant ID is hard-coded in AppContext.tsx, client-side role checks are the sole access-control gate for sensitive admin operations (there is no server-side field-level security enforcement in the service layer), and the feature-flag system is entirely localStorage-backed, making it trivially bypassable by any authenticated browser user. A second critical cluster is data-integrity: six separate Dataverse text fields (`cgmp_projectids`, `cgmp_uatusers`, `cgmp_assignedlocations`, `cgmp_attachmentids`, `cgmp_notificationcategories`, `cgmp_assignedprojectids`) store comma- or semicolon-delimited GUIDs or free text where proper N:N relationships or option-set columns should be used; the `cgmp_versionhistory` field on `cgmp_changes` stores comments, MTTR entries, reschedule proposals, and edit history in a single uncapped JSON blob alongside version diffs; and the `cgmp_changehistory` table exists in the generated model but receives no writes from the application. These are not cosmetic concerns — they create hard limits on querying, reporting, and audit integrity.

Performance and scalability represent the third critical theme. Every workspace independently fetches the same full datasets from Dataverse: `useChanges` (top 1000), `useChangeList` (top 500), `useAllBridges` (top 200), and `UserProfilesContext` (top 500) each run their own un-coordinated requests; the `AdminDashboard` fires seven parallel `top: 1000` queries on every render-refresh; and the `useSystemUsers` hook retrieves up to 1000 AAD users without server-side filtering. No server-side pagination is implemented anywhere in the application. At 1,000+ changes the platform will begin to exhibit perceptible latency and at 5,000+ it will become practically unusable without a TanStack Query or similar caching and pagination layer. The notification polling system executes a Dataverse query every 30 seconds per active session with no backoff or debounce, creating a polling fan-out that scales linearly with concurrent users.

Despite these issues the platform demonstrates genuine enterprise ambition and a level of implementation maturity that puts it well ahead of typical Power Apps no-code solutions. The workflow coverage is functionally broad, the inline comments/reschedule-proposal system is well-engineered, the blackout-period gate is correctly implemented with a server-side data source, the concurrent-edit advisory locking is pragmatic for the Power Platform context, and Application Insights integration (though partially disabled) is in place. With the critical security and data-integrity findings resolved and the performance architecture refactored to use a shared data layer with proper pagination, this platform can credibly serve as the production change-governance system for a global enterprise organisation. The roadmap in Section 4 provides a prioritised remediation path.

---

## Section 2 — Enterprise Readiness Scorecard

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| UI/UX Design | 72% | Shell layout, theme switching, responsive sidebar, skip links, and breadcrumb navigation are well-executed. Workspaces have consistent stat-chip tab patterns and skeleton loading states. Gaps: no mobile-specific breakpoints below 768 px for table-heavy workspaces; empty-state designs are inconsistent across modules; DataTable lacks virtualisation; the RightPanel quick-filter links use emoji labels without screen-reader alternatives. |
| Component Architecture | 68% | Lazy-loaded workspace routing, shared UI primitives (FormFields, DataTable, Modal), and context-driven state are architecturally correct. However, ChangeForm.tsx exceeds 1,200 lines and conflates form state, auto-save, concurrent edit, reschedule, and comment logic; ISMWorkspace imports directly from GIICCCommandCenter (tight coupling); and there is no shared data-layer abstraction (TanStack Query, SWR) — each hook manages its own loading/error state independently. |
| Business Logic Completeness | 65% | The change lifecycle state machine is well-defined in `roles.ts` and respected by workspace components. ISM sign-off (`cgmp_ismsignoffat/by` fields exist) but no explicit sign-off action is surfaced to the ISM user. PIR approval workflow has status codes (Draft/Submitted/Approved/Rejected) but the Approved/Rejected transitions are never triggered. DeptAdmin (100000007) has role codes but no dedicated workflow. ISMDeputy inherits ISM transitions but is excluded from `ALLOWED_TRANSITIONS`. Emergency fast-track is behind a feature flag but the 240-minute SLA timer is only a client-side display. |
| Data Architecture | 52% | Dataverse table structure is functional but carries six string-blob fields that should be relational, a mixed-concern JSON column (`cgmp_versionhistory`), no alternate keys on frequently-filtered fields (`cgmp_userprincipalname`, `cgmp_changenumber`), no Dataverse-native change-tracking, and ISM identification dual-tracks between a display-name string and a GUID field. The `cgmp_changehistory` table exists but is unused. |
| React / TypeScript Quality | 74% | TypeScript strict mode is enabled and the compiler is largely satisfied. Path aliases, `verbatimModuleSyntax`, and `noUnusedLocals` are configured correctly. Remaining issues: widespread `as unknown as number` and `as any` casts in service calls and model field access; `as never` in update calls; several components use inline `any` for option-set fields; `HistoryEntry` and reschedule payloads are typed as `any[]`. No tests exist. |
| Performance | 55% | Lazy workspace loading, a single `manualChunks` config for vendor and App Insights, and `useMemo`/`useCallback` for expensive computations are positive. Critical gaps: no pagination (all lists capped by `top:` parameter with no `nextLink` handling), no data deduplication across hooks fetching the same entity set, no row virtualisation for large DataTable renders, 30-second notification polling with no backoff, and the AdminDashboard fires 7 parallel top-1000 queries. |
| Security | 48% | CSP header in index.html is present but allows `unsafe-inline` and `unsafe-eval` in `script-src`. A production tenant ID is hard-coded in AppContext.tsx. All access control is client-side only. Feature flags are localStorage-controllable by any user. The OData injection protection in `AppContext` is correct but inconsistently applied elsewhere. `Cgmp_bridgesService` omits the `checkForAuthError` call present in `Cgmp_changesService`. No HTTPS-only enforcement, no token refresh strategy, no field-level security documented. |
| Operational Excellence | 55% | Application Insights is integrated with page-view and exception tracking but AJAX/fetch tracking is disabled, eliminating API performance visibility. No CI/CD pipeline exists. No unit, integration, or E2E tests exist. The Teams manifest hard-codes production app and tenant IDs. The `.env.example` file is present but a `.gitignore` and secrets-management strategy are not confirmed. Deployment scripts (`deploy-app.ps1`, `deploy-schema.ps1`) exist but are not part of any automated pipeline. |
| Enterprise Features | 70% | Eight roles, feature flags, blackout periods, notification preferences, scheduling calendar, capacity planning, leaderboards, heat maps, audit logs, Knowledge Base, Power BI embedding, CSV export, and a Teams manifest are all present. Gaps: no offline/low-connectivity mode, no print layout, no SLA escalation from the client side (correctly delegated to Power Automate), no real-time collaborative editing, no deep-link URL routing (all navigation is SPA state). |
| Accessibility (WCAG) | 61% | Skip links, ARIA landmarks, `aria-label` attributes on interactive elements, keyboard navigation in search/header, `role="alert"` on banners, and `aria-current="page"` on sidebar items are implemented. Gaps: DataTable rows are not keyboard-accessible for selection; SVG donut/line charts have `role="img"` and `<title>` but no `<desc>` or data table alternative; modal focus trap is not verified; colour-only risk indicators (badges) are supplemented with shape icons but not consistently; form validation errors are not announced to screen readers via `aria-live`. |
| **Overall Composite** | **62%** | The platform is architecturally promising and functionally broad, but is not production-ready without resolving the security, data-integrity, and performance findings rated Critical and High. Estimated 8–12 weeks of focused engineering effort to reach production quality at the Critical+High level. |

---

## Section 3 — Findings

---

### F-001: Hardcoded Production Tenant ID in AppContext
| Field | Value |
|-------|-------|
| Module | `src/context/AppContext.tsx` line 204 |
| Category | Security |
| Priority | Critical |
| Complexity | Low |

**Current Implementation:** `const tenantId = 'e0793d39-0939-496d-b129-198edd916feb';` is embedded directly in the `logout()` callback. This GUID is the live Azure AD tenant ID and is committed to the repository.

**Expected Implementation:** Tenant ID must be read from the build-time environment variable `VITE_TENANT_ID` (already declared in `.env.example`): `const tenantId = import.meta.env.VITE_TENANT_ID ?? '';`. The function should guard against an empty value and surface an error rather than silently constructing a broken logout URL.

**Root Cause:** The constant was added during initial development for rapid iteration and was never externalised before being promoted to shared source control.

**Business Impact:** Any developer with read access to the repository can enumerate the tenant ID, enabling targeted phishing, token-replay attacks scoped to this tenant, and social-engineering attacks against tenant administrators. It also makes the codebase non-portable across development, staging, and production environments without manual file edits.

**Recommended Solution:** Replace the hard-coded value with `import.meta.env.VITE_TENANT_ID`. Add a build-time assertion in `vite.config.ts` that throws if the variable is absent in non-development builds. Rotate or monitor the tenant ID in Azure AD conditional access logs to detect any abuse before the fix is deployed.

---

### F-002: Production App and Tenant IDs Hard-Coded in Teams Manifest
| Field | Value |
|-------|-------|
| Module | `teams/manifest.json` lines 5–62 |
| Category | Security |
| Priority | Critical |
| Complexity | Low |

**Current Implementation:** The manifest contains the production Power Apps environment ID (`5b9db983-0709-e578-ba8e-29a88812c217`), app GUID (`c1f14cf8-797a-48cf-b56f-12943eb06bf4`), and tenant ID (`e0793d39-0939-496d-b129-198edd916feb`) as literal strings in all `contentUrl`, `websiteUrl`, `id`, and `webApplicationInfo.id` fields. The `_envConfig` comment acknowledges this is wrong but the issue was not fixed.

**Expected Implementation:** The manifest should be a template (`manifest.template.json`) with placeholder tokens (`{{TENANT_ID}}`, `{{APP_ID}}`, `{{ENV_ID}}`). A pre-deployment script substitutes the correct values per environment before packaging the `.zip`. This is standard practice and aligns with the Teams Toolkit `teamsapp.yml` approach.

**Root Cause:** The manifest was authored for the production environment during initial deployment and then committed without a templating mechanism.

**Business Impact:** Any person with repository access learns the exact production Power Apps environment and app IDs, enabling direct URL access attempts, DoS-style repeated requests to the Power Platform API, and enumeration of environment metadata without authentication.

**Recommended Solution:** Introduce a `teams/manifest.template.json` with `{{TOKEN}}` placeholders. Add a PowerShell deployment step that reads values from environment-specific `.env` files and produces `teams/manifest.json` as a build artifact (excluded from `.gitignore`). Add `teams/manifest.json` to `.gitignore`.

---

### F-003: All Role-Based Access Control is Client-Side Only
| Field | Value |
|-------|-------|
| Module | `src/context/AppContext.tsx`, `src/components/Sidebar.tsx`, all workspace components |
| Category | Security |
| Priority | Critical |
| Complexity | High |

**Current Implementation:** Role enforcement is performed entirely in the browser. The Sidebar filters navigation items by `userRole` (lines 90–101 of `Sidebar.tsx`). Individual workspace components check `isAdmin`, `isPMO`, etc. from context before rendering UI. No server-side field-level security, row-level security, or Dataverse table permission enforcement is documented or implemented in the service layer. Any user who knows the URL of a workspace or who manipulates the context value in browser developer tools can access any functionality.

**Expected Implementation:** Dataverse column-level security profiles must be applied to sensitive fields (`cgmp_ismsignoffby`, `cgmp_reviewedby`, `cgmp_releasedby`, audit log fields). Dataverse table permissions on `cgmp_changes`, `cgmp_userprofiles`, `cgmp_auditlogs`, and `cgmp_bridges` must restrict create/update/delete operations to roles that own those operations. The Power Apps Code App should additionally enforce role checks before calling service methods — a thin guard at the service invocation point that reads the current `userProfile.cgmp_role` and throws before making the API call if the role is insufficient.

**Root Cause:** Power Apps Code Apps do not automatically inherit Dataverse row-level security unless explicitly configured in the Dataverse environment. The development team relied on UI-level hiding as the primary control.

**Business Impact:** A PMO user who inspects the app bundle, identifies the `Cgmp_userprofilesService.update` API signature, and calls it directly from the browser console can escalate their own role to Admin (100000000). A malicious ITOps user could transition a change directly to Completed without GIICC approval by calling `Cgmp_changesService.update` directly.

**Recommended Solution:** (1) Configure Dataverse column security profiles for all sensitive fields. (2) Configure Dataverse table permissions so each security role (mapped 1:1 to Dataverse security roles) can only create/update the records it owns. (3) Add a `SecurityGuard` utility at the top of each service call site in the application: `if (!canTransition(currentStatus, nextStatus, roleCode)) throw new Error(CGMP_ERRORS.E031.message)`. This does not replace server-side controls but provides defence in depth.

---

### F-004: Feature Flags Stored in localStorage — Trivially Bypassable
| Field | Value |
|-------|-------|
| Module | `src/utils/featureFlags.ts`, `src/context/FeatureFlagsContext.tsx` |
| Category | Security |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** Feature flags (including `'emergency-fast-track'` which triggers a reduced 4-hour SLA threshold) are stored as a JSON object in `localStorage` under the key `cgmp-feature-flags`. Any browser user can open DevTools and run `localStorage.setItem('cgmp-feature-flags', '{"emergency-fast-track":true}')` to enable any flag. There is no server-side validation that the enabled flag corresponds to an authorised configuration.

**Expected Implementation:** Feature flags that affect business-logic behaviour (SLA thresholds, emergency bypass) must be server-authoritative. Options in the Power Platform context: (1) Store flags in a `cgmp_featuresettings` Dataverse table with Admin-only write access, loaded on app initialisation alongside the user profile. (2) Use Power Platform Environment Variables (available in Dataverse solutions) for environment-level flag values. localStorage-based flags are acceptable only for purely cosmetic UI preferences (theme, column visibility).

**Root Cause:** The feature-flag mechanism was designed for rapid local development iteration and never graduated to a server-authoritative implementation.

**Business Impact:** Any authenticated user can self-enable `emergency-fast-track` and have their change processed under a 4-hour SLA window, bypassing the standard 48-hour review gate. This represents a direct control circumvention in the change governance process.

**Recommended Solution:** Add a `cgmp_notificationrules`-style Dataverse table `cgmp_applicationsettings` with fields for flag name, value, and Admin-only write permission. Load settings in `AppProvider` alongside the user profile. Keep the localStorage fallback only for development environments where `import.meta.env.DEV` is true.

---

### F-005: CSP Header Allows `unsafe-inline` and `unsafe-eval`
| Field | Value |
|-------|-------|
| Module | `index.html` line 9 |
| Category | Security |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** The Content Security Policy in `index.html` includes `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.microsoft.com`. The `unsafe-inline` directive allows arbitrary inline `<script>` execution and the `unsafe-eval` directive allows `eval()`, `Function()`, and similar dynamic code execution. This effectively neutralises the XSS protection that a CSP is meant to provide.

**Expected Implementation:** Replace `unsafe-inline` with a `nonce-` or `hash-` based approach compatible with Vite's build output. Replace `unsafe-eval` with `wasm-unsafe-eval` if WebAssembly is required, or remove it entirely if not. The Power Apps SDK and App Insights packages should not require `unsafe-eval` in production builds.

**Root Cause:** The Power Apps SDK (`@microsoft/power-apps`) may internally use `eval` in development builds; the CSP was loosened to accommodate this without distinguishing between development and production configurations.

**Business Impact:** If a stored XSS vulnerability is introduced (e.g., through unescaped Dataverse field content rendered in the UI), the CSP will not block the exploit. An attacker could exfiltrate auth tokens or session data.

**Recommended Solution:** Audit the Power Apps SDK's production bundle for `eval` usage. If absent, remove `unsafe-eval`. Use Vite's `plugin-legacy` nonce injection or generate per-request nonces at the hosting layer. Apply stricter policies in the production Power Apps environment deployment.

---

### F-006: `Cgmp_bridgesService` Missing Auth Error Detection
| Field | Value |
|-------|-------|
| Module | `src/generated/services/Cgmp_bridgesService.ts` |
| Category | Bug |
| Priority | High |
| Complexity | Low |

**Current Implementation:** `Cgmp_changesService` (and `Cgmp_userprofilesService` via its companion comment) calls `checkForAuthError(result)` after every API call, which detects 401/403 responses and dispatches the `cgmp-session-expired` event to trigger the `SessionExpiredBanner`. `Cgmp_bridgesService` performs the same create/update/get/getAll calls but **never** calls `checkForAuthError`. The `checkForAuthError` function and `dispatchSessionExpiry` are defined only in `Cgmp_changesService.ts` and are not shared.

**Expected Implementation:** Either (a) extract `checkForAuthError` and `dispatchSessionExpiry` into a shared utility file (`src/utils/authGuard.ts`) imported by every generated service, or (b) create a `BaseService` class that wraps the Dataverse client and applies the check on all responses. Every service's `create`, `update`, `get`, and `getAll` methods must call this check.

**Root Cause:** The `checkForAuthError` function was added to `Cgmp_changesService` as a targeted patch but the pattern was not propagated to the other generated services. The generated code comment on `Cgmp_changesService` explicitly notes this debt.

**Business Impact:** When a session expires during bridge execution (which can run for hours), the app will silently fail on all bridge-related operations without surfacing the "Session Expired" banner. The user receives no indication of why saves are failing and may lose bridge execution state.

**Recommended Solution:** Create `src/utils/authGuard.ts` exporting `checkForAuthError` and `dispatchSessionExpiry`. Update all generated services to import and call it. Add a `regen` post-processing script that patches the generated output to include the import, so it survives future `pac modelbuilder build` runs.

---

### F-007: `cgmp_versionhistory` Overloaded as Multi-Purpose JSON Blob
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts`, `src/components/pmo/ChangeForm.tsx` lines 162–413, `src/utils/business.ts` `appendHistory()` |
| Category | Architecture |
| Priority | Critical |
| Complexity | High |

**Current Implementation:** The single `cgmp_versionhistory` text field on `cgmp_changes` stores at least six distinct data types in a single JSON array: edit diffs (`_type: 'edit'`), inline comments (`_type: 'comment'`), deleted comments (`_type: 'comment_deleted'`), reschedule proposals (`_type: 'rescheduleProposed'`), reschedule acceptances (`_type: 'rescheduleAccepted'`), reschedule declines (`_type: 'rescheduleDeclined'`), and MTTR entries (`_type: 'mttr'`). The `appendHistory` utility caps entries at 500 and trims to 450 when the cap is reached, which silently discards the oldest audit events.

**Expected Implementation:** Each concern should be a separate Dataverse entity or a structured sub-field: (1) Comments → `cgmp_changecomments` table with `cgmp_changeid` lookup, `cgmp_content`, `cgmp_author`, `cgmp_createdon`, and a soft-delete flag. (2) Reschedule proposals → `cgmp_rescheduleproposals` table. (3) MTTR → a numeric field `cgmp_mttrhours` on `cgmp_changes`. (4) Version diffs → the existing `cgmp_changehistory` table should be used (it is currently unused). This enables proper OData querying, audit reporting, and eliminates the 500-entry cap.

**Root Cause:** The JSON blob approach was chosen for implementation speed — it requires no Dataverse schema changes and no new service methods. The `cgmp_changehistory` table was created but its purpose was superseded by the blob approach before it was wired up.

**Business Impact:** Audit logs stored in `cgmp_versionhistory` are not queryable through OData, cannot be included in Power BI reports without ETL, are silently truncated after 500 entries, and are overwritten if two users save the change simultaneously within the read-modify-write cycle (the app mitigates this with a re-fetch, but race conditions remain). This undermines the platform's claim to provide a complete audit trail.

**Recommended Solution:** Phase 1: add `cgmp_comments` and `cgmp_rescheduleproposals` tables to the Dataverse solution and wire up new services. Migrate existing blob entries on load using a one-time migration flow in Power Automate. Phase 2: use `cgmp_changehistory` for field-level diffs. Phase 3: remove `appendHistory` and the JSON parsing from `ChangeForm`.

---

### F-008: `cgmp_projectids` Stored as Comma-Separated GUID String
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts` (`cgmp_projectids?: string`), `src/components/pmo/ChangeForm.tsx` line 94, `src/hooks/useDataverse.ts` `useChangeList` select |
| Category | Architecture |
| Priority | High |
| Complexity | High |

**Current Implementation:** The many-to-many relationship between changes and projects is implemented by storing a comma-separated list of project GUIDs in the text field `cgmp_projectids` on `cgmp_changes`. The UI splits this string on commas throughout every workspace that renders impacted projects. There is no referential integrity, no cascade delete, and no ability to query "all changes for project X" without a full-table scan with string matching.

**Expected Implementation:** Implement a proper Dataverse N:N relationship (`cgmp_changes_cgmp_projects_nn`) using the standard Dataverse many-to-many association mechanism. This generates a relationship table automatically and enables `$expand` in OData queries. Replace all `cgmp_projectids.split(',')` usages with proper relationship traversal.

**Root Cause:** Dataverse N:N relationships require schema work and are more complex to query via the Power Apps SDK than a simple text field. The string approach was chosen for implementation speed.

**Business Impact:** Querying all changes for a given project requires loading all 500–1000 changes and filtering client-side. Project deletion does not clean up dangling GUIDs in change records. Reporting on project-level change counts is inaccurate if any project is renamed or its GUID changes. The `useChangeList` hook's `select` clause includes `cgmp_projectids` to perform client-side project name lookups, wasting bandwidth.

**Recommended Solution:** Create the N:N relationship in the Dataverse solution. Add a migration Power Automate flow that reads existing `cgmp_projectids` values and creates the corresponding relationship records. Update the service calls to use `$expand=cgmp_changes_cgmp_projects_nn($select=cgmp_projectid,cgmp_name)`. This is a breaking schema change requiring a solution version bump.

---

### F-009: `cgmp_changehistory` Table Exists but Receives Zero Writes
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changehistoryModel.ts`, `src/generated/services/Cgmp_changehistoryService.ts` (generated but unimported) |
| Category | Feature Gap |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** A `cgmp_changehistory` Dataverse table exists with fields `cgmp_actor`, `cgmp_changeid`, `cgmp_details`, `cgmp_eventtype`, and `cgmp_timestamp`. The generated service class `Cgmp_changehistoryService` is exported from `src/generated/index.ts`. No component or hook in the application imports or calls this service — all history is written to the JSON blob in `cgmp_versionhistory` instead.

**Expected Implementation:** `Cgmp_changehistoryService.create()` should be called on every status transition, field edit, comment addition, reschedule proposal, and bridge lifecycle event. The `cgmp_details` field should store a structured JSON diff. This replaces the JSON-blob version history with a properly normalised, queryable audit trail.

**Root Cause:** The `cgmp_changehistory` table was created as part of the schema design but the implementation chose the JSON blob approach before the history service was wired up. The service has sat unused since generation.

**Business Impact:** The platform cannot provide queryable, time-series field-level change history for regulatory compliance or investigation purposes. The only audit record is the `cgmp_auditlogs` table (which logs events but not field diffs) and the JSON blob (which is capped and non-queryable).

**Recommended Solution:** Wire `Cgmp_changehistoryService.create()` into the `handleSave` function in `ChangeForm.tsx` and into every status-transition call site. Deprecate `appendHistory` for the diff use case. Keep `cgmp_versionhistory` only for the comment thread (until that is migrated to its own table per F-007).

---

### F-010: ISM Sign-Off Fields Exist but Sign-Off Action is Missing
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts` (`cgmp_ismsignoffat`, `cgmp_ismsignoffby`), `src/components/ism/ISMWorkspace.tsx` |
| Category | Feature Gap |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** The `cgmp_changes` table has `cgmp_ismsignoffat` (datetime) and `cgmp_ismsignoffby` (string) fields. The `ALLOWED_TRANSITIONS` in `roles.ts` does not include any ISM → Released or ISM → Locked transition. The ISM Workspace has tabs for changes, compliance, UAT status, and action items, but no explicit "ISM Sign-Off" button or modal. The `isIsmFrozen` function is called and displayed as a warning but does not block any action in the form.

**Expected Implementation:** The ISM Workspace should surface a dedicated "Sign Off" action on changes in the `Released` status (before they move to `InProgress`). Clicking it should: (1) update `cgmp_ismsignoffat` to the current timestamp, (2) update `cgmp_ismsignoffby` to the current user's name/UPN, (3) create a `cgmp_auditlogs` record with `cgmp_eventtype = ChangeLocked`, (4) notify the GIICC team, and (5) optionally require a sign-off note. The `ALLOWED_TRANSITIONS` table should be extended to include `STATUS.Released → STATUS.Locked` for `ROLES.ISM` and `EXTENDED_ROLES.ISMDeputy`.

**Root Cause:** The sign-off fields were modelled in the data schema but the corresponding UI action was not implemented in the ISM Workspace during the initial feature sprint.

**Business Impact:** Changes proceed from Released to InProgress (GIICC-initiated) without a mandatory ISM validation gate. This means GIICC can begin bridge execution for changes that the ISM team has not reviewed against the UAT contact list or compliance checklist — a process control failure.

**Recommended Solution:** Add a `SignOffDialog` component to `ISMWorkspace`. Wire it to a new `handleSignOff` async function that calls `Cgmp_changesService.update` with the sign-off fields and creates the audit log. Add `STATUS.Released → STATUS.Locked` to `ALLOWED_TRANSITIONS` for role 100000003 (ISM) and 100000006 (ISMDeputy).

---

### F-011: PIR Approval Workflow is Incomplete — Approved/Rejected States Unreachable
| Field | Value |
|-------|-------|
| Module | `src/components/giicc/PIRForm.tsx`, `src/generated/models/Cgmp_changesModel.ts` (`Cgmp_changescgmp_pirstatus`) |
| Category | Feature Gap |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** The `Cgmp_changescgmp_pirstatus` option set has four values: `Draft (100000000)`, `Submitted (100000001)`, `Approved (100000002)`, `Rejected (100000003)`. `PIRForm.handleSave()` sets `cgmp_pirstatus: 100000001` (Submitted) when saving. No component anywhere in the codebase sets the PIR status to `Approved` (100000002) or `Rejected` (100000003). There is no PIR review workflow for Admin or ISM roles to approve submitted PIRs.

**Expected Implementation:** After a bridge is completed and a PIR is submitted by GIICC, a notification should be sent to the change's ISM (and optionally Admin). The ISM Workspace should surface a "PIR Review" tab or banner for changes with `cgmp_pirstatus = 100000001 (Submitted)`. From there, ISM (and Admin) can approve or reject the PIR, which sets the status to `Approved` or `Rejected` and closes the change lifecycle. The PMO Workspace should show the PIR status in the change list.

**Root Cause:** The four-state PIR workflow was modelled in the Dataverse schema but only the first two states (Draft, Submitted) were implemented in the UI.

**Business Impact:** All submitted PIRs remain in "Submitted" state indefinitely. There is no ISM sign-off on lessons learned, no way to formally close the post-incident review, and no reporting on PIR approval rates — a key metric for change governance maturity.

**Recommended Solution:** Add a PIR approval action to `ISMWorkspace` for changes with `cgmp_pirstatus = 100000001`. Create a `PIRApprovalDialog` with approve/reject and notes fields. Wire to `Cgmp_changesService.update({ cgmp_pirstatus: 100000002 })` and `Cgmp_auditlogsService.create(...)`. Add a notification to the GIICC team on approval/rejection.

---

### F-012: DeptAdmin Role (100000007) Has No Dedicated Workflow or Workspace
| Field | Value |
|-------|-------|
| Module | `src/utils/roles.ts` (`EXTENDED_ROLES.DeptAdmin = 100000007`), `src/components/Sidebar.tsx` line 99 |
| Category | Feature Gap |
| Priority | Medium |
| Complexity | High |

**Current Implementation:** `DeptAdmin` is defined in `EXTENDED_ROLES` with a label of "Department Administrator" and role code 100000007. The Sidebar gives DeptAdmin the same navigation access as full Admin (line 99: `if (userRole === EXTENDED_ROLES.DeptAdmin) return ALL_NAV_ITEMS`). The `hasAdminPermissions(role)` function in `roles.ts` returns true for DeptAdmin. However, there is no workspace, dashboard, or scoped view that limits DeptAdmin to their assigned department/location — they see all data identically to a full Admin.

**Expected Implementation:** DeptAdmin should have a scoped view: (1) Changes filtered to their `cgmp_assignedlocations` intersection. (2) Projects filtered to their assigned locations. (3) Admin capabilities (role assignment, template management) restricted to users within their department. (4) A `DeptAdminDashboard` component similar to `AdminDashboard` but with department-scoped KPIs.

**Root Cause:** The DeptAdmin role was added to the option set and RBAC model as a forward-planning exercise but the corresponding scoped views and permission boundaries were not implemented.

**Business Impact:** A DeptAdmin user currently has effectively the same unrestricted read/write access as the global Admin, undermining the principle of least privilege. In a multi-department deployment, a DeptAdmin for one location could modify change records, user profiles, and templates for other locations.

**Recommended Solution:** Add location-scoping logic throughout the data fetch layer for the DeptAdmin role: `if (isDeptAdmin) filter = \`cgmp_location in (${assignedLocations.join(',')})\``. Implement a `DeptAdminDashboard` component. Restrict role-assignment UI in `SecurityRoles` to only show users within the DeptAdmin's assigned locations.

---

### F-013: ISMDeputy (100000006) Not Represented in ALLOWED_TRANSITIONS
| Field | Value |
|-------|-------|
| Module | `src/utils/roles.ts` `ALLOWED_TRANSITIONS` (lines 74–111) |
| Category | Bug |
| Priority | High |
| Complexity | Low |

**Current Implementation:** `ALLOWED_TRANSITIONS` is keyed by `RoleCode` which is typed as `typeof ROLES[keyof typeof ROLES]` — only the five base roles (100000000–100000004). ISMDeputy (100000006) is in `EXTENDED_ROLES` and not in `ROLES`. The Sidebar and `AppContext` both treat ISMDeputy as having ISM-equivalent permissions (line 226 in `AppContext`: `isISM = roleCode === ROLES.ISM || roleCode === EXTENDED_ROLES.ISMDeputy`). However, `getAllowedTransitions(currentStatus, 100000006)` returns `[]` for every status because ISMDeputy's role code is never a key in the transition table. Any status-transition action performed by an ISMDeputy will be blocked at the `canTransition` check.

**Expected Implementation:** Either (1) expand `RoleCode` to include `ExtendedRoleCode` and add ISMDeputy entries mirroring ISM's allowed transitions in `ALLOWED_TRANSITIONS`, or (2) modify `getAllowedTransitions` to map ISMDeputy (100000006) to ISM's (100000003) transition set before the lookup: `const effectiveRole = role === EXTENDED_ROLES.ISMDeputy ? ROLES.ISM : role`.

**Root Cause:** ISMDeputy was added to `EXTENDED_ROLES` after the initial `ALLOWED_TRANSITIONS` table was written, and the table was not updated to include extended role codes.

**Business Impact:** An ISM Deputy cannot complete any of the ISM-role workflow actions (UAT sign-off, concern raising, etc.) because `canTransition` always returns false for their role code, silently blocking the action. This makes the ISMDeputy role non-functional.

**Recommended Solution:** Option 2 is lower risk: add a single line to `getAllowedTransitions`: `const effectiveRole = (role === EXTENDED_ROLES.ISMDeputy) ? ROLES.ISM : (role === EXTENDED_ROLES.DeptAdmin) ? ROLES.Admin : role;` before the lookup. Add a unit test to verify transitions work for all eight role codes.

---

### F-014: Emergency Fast-Track Approval Has No Enforced Workflow Gate
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` `getSlaThresholdHours()`, `src/utils/featureFlags.ts`, `src/components/pmo/ChangeForm.tsx` line 853 |
| Category | Feature Gap |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** When the `emergency-fast-track` feature flag is enabled, `getSlaThresholdHours()` returns 4 hours instead of 48. The `ChangeForm` displays an "EMERGENCY CHANGE — 240-minute SLA" banner and fires a notification to all Admin profiles when an emergency change is published (line 853–867). However, there is no approval gate, no mandatory Admin acknowledgement before the change proceeds, no dedicated fast-track queue in any workspace, and no prevention of a standard change being flagged as emergency without Admin pre-authorisation.

**Expected Implementation:** Emergency changes should trigger a mandatory Admin (or designated emergency approver) acknowledgement workflow: (1) On `cgmp_isemergency = true` publish, send an urgent notification to all Admin profiles and require at least one Admin to explicitly approve the emergency designation before the change moves past Published. (2) Add a `cgmp_emergencyapprovedby` field to `cgmp_changes`. (3) Surface an "Emergency Queue" tab in the ITOps Workspace showing only emergency changes with a prominent 4-hour SLA countdown. (4) Prevent non-Admin users from self-designating a change as emergency without an explicit pre-authorisation code from an Admin.

**Root Cause:** The emergency banner and notification were added as partial implementation. The full approval gate workflow was deferred.

**Business Impact:** Any PMO user can submit a change as "emergency" and have it processed under a 4-hour SLA with no oversight. This can be used to circumvent the standard review process for non-urgent changes, exposing the environment to unreviewed changes.

**Recommended Solution:** Add `cgmp_emergencyapprovedby` to the schema. Modify the `ALLOWED_TRANSITIONS` for emergency changes to require this field to be populated before ITOps can move from Published to UnderReview. Surface an emergency approval modal in the ITOps Workspace for changes where `cgmp_isemergency = true` and `cgmp_emergencyapprovedby` is null.

---

### F-015: Concurrent Edit Detection is Advisory Only — No Actual Record Lock
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 663–708 |
| Category | Feature Gap |
| Priority | Medium |
| Complexity | High |

**Current Implementation:** When a user opens the edit form, the app queries `cgmp_auditlogs` for `cgmp_eventtype = 100000003 (ChangeUpdated)` records with `createdon >= 10 minutes ago` for the same change ID. If another user's `editedBy` is found in a recent audit log, a warning banner is shown. The user can click "Override — Edit Anyway" to dismiss the warning. The lock is purely advisory — no actual Dataverse record locking prevents concurrent writes.

**Expected Implementation:** For a production change-governance system, concurrent edit conflicts must be prevented more robustly. Options in the Power Platform context: (1) Use Dataverse optimistic concurrency via `If-Match: ETag` headers on update calls (available through the Web API but not exposed in the current SDK abstraction). (2) Store an explicit lock record in a `cgmp_editlocks` table with `cgmp_changeid`, `cgmp_lockedby`, `cgmp_lockedat`, and a TTL. Clear the lock on form close. (3) At minimum, re-fetch the record's `versionnumber` before every save and compare with the version seen when the form was opened — if different, show a conflict resolution UI rather than silently overwriting.

**Root Cause:** The Dataverse client SDK used (`@microsoft/power-apps/data`) does not natively expose optimistic concurrency headers, requiring a custom fetch wrapper to implement.

**Business Impact:** Two PMO managers editing the same change simultaneously will silently overwrite each other's changes. The last writer wins with no merge capability. In a high-volume change window this can cause data loss.

**Recommended Solution:** Implement a `cgmp_editlocks` Dataverse table. On form open: create a lock record. On form close/save: delete it. On form open check: query for active locks older than 5 minutes (stale-lock TTL). A Power Automate scheduled flow should purge stale locks older than 15 minutes. This is feasible without custom fetch wrapper changes.

---

### F-016: Missing Rollback-Initiated Workflow — Field Exists, Action Does Not
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts` (`cgmp_rollbackinitiated?: boolean`), `src/components/pmo/ChangeList.tsx`, `src/components/itops/ITOpsWorkspace.tsx` |
| Category | Feature Gap |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** `cgmp_rollbackinitiated` is a boolean field on `cgmp_changes` and is displayed in the ChangeList with a special indicator badge. However, there is no UI action to set `cgmp_rollbackinitiated = true`. The field is read-only from the application's perspective — it appears in column selections but no component writes to it.

**Expected Implementation:** During InProgress or Failed status, authorised roles (Admin, GIICC) should be able to trigger a rollback by setting `cgmp_rollbackinitiated = true` and creating an audit log entry. This should optionally trigger a notification to the change owner and the bridge team. A rollback reason field (`cgmp_rollbackreason` exists on `cgmp_bridges` but not on `cgmp_changes`) should be added to `cgmp_changes`.

**Root Cause:** The field was modelled for future rollback tracking but the write path was not implemented.

**Business Impact:** Rollback events are not formally recorded in the change record. Post-incident analysis cannot determine whether a change was rolled back by looking at the change record alone.

**Recommended Solution:** Add a "Initiate Rollback" button in the GIICC Command Center for InProgress changes. Wire it to `Cgmp_changesService.update({ cgmp_rollbackinitiated: true })` plus an audit log. Add `cgmp_rollbackreason` text field to `cgmp_changes` in the schema.

---

### F-017: No Pagination Implemented — All Queries Use Hard `top:` Limits
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` all hooks; `src/components/admin/AdminDashboard.tsx` line 57 |
| Category | Performance |
| Priority | Critical |
| Complexity | High |

**Current Implementation:** Every Dataverse query in the application uses a fixed `top:` parameter: `useChanges` (top: 1000), `useChangeList` (top: 500), `useAllBridges` (top: 200), `useNotifications` (top: 200), `useProjects` (top: 500), `UserProfilesContext` (top: 500), `useSystemUsers` (top: 1000), `AdminDashboard` (top: 1000 × 7 entities). No hook checks the `nextLink` or `@odata.nextLink` property of the response to load additional pages. If a query returns exactly `top:` records there may be more data on the server that the application silently ignores.

**Expected Implementation:** The Dataverse OData API returns a `nextLink` in the response when there are more records. Each hook should implement a `fetchAll` loop that follows `nextLink` until exhausted, OR (preferred) the application should adopt server-side pagination where only the current page is loaded and the user navigates between pages. TanStack Query's `useInfiniteQuery` pattern is the idiomatic solution. At minimum, the `IGetAllOptions` type should expose a `nextLink` continuation mechanism.

**Root Cause:** The Power Apps SDK's `retrieveMultipleRecordsAsync` wraps the OData response and the `IOperationResult<T[]>` type does not clearly expose `@odata.nextLink`. The team implemented fixed `top:` limits as a pragmatic solution.

**Business Impact:** At 1,001 changes the `useChanges` hook silently drops all records beyond 1,000. The Dashboard KPIs, SLA calculations, and trend charts will be incorrect. At 501 changes the ChangeList will not show all records. In a global enterprise deployment with multiple years of historical changes, this is a near-term certainty.

**Recommended Solution:** Short-term: increase `top:` limits to 5000 and add a visible warning when results are truncated (check `result.data.length === top`). Medium-term: implement TanStack Query with `useInfiniteQuery` for the ChangeList. Long-term: migrate high-volume queries to server-side aggregation via Dataverse Web API `$apply` (OData aggregation) for KPI data rather than loading raw records.

---

### F-018: AdminDashboard Fires Seven Parallel top-1000 Queries on Every Refresh
| Field | Value |
|-------|-------|
| Module | `src/components/admin/AdminDashboard.tsx` lines 54–63 |
| Category | Performance |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** `AdminDashboard.loadAll()` calls `Promise.allSettled` with seven simultaneous `getAll({ top: 1000 })` queries — changes, bridges, tasks, notifications, projects, user profiles, and audit logs. Each call returns up to 1,000 records across the wire. The total data transfer per refresh is 7 × (up to 1,000 records × record size) — potentially several megabytes. There is a manual refresh button and the component refreshes on every mount.

**Expected Implementation:** KPI counts should use Dataverse `$apply=aggregate($count as count)` OData queries rather than fetching all records. For the "total changes" KPI, the query should be: `getAll({ filter: '', select: ['cgmp_changeid'], top: 1 })` with the `@odata.count` property, or a dedicated count endpoint. Each service can implement a static `count(filter?: string)` method. Audit logs for the activity feed legitimately need records (top: 10 is correct) but all seven queries should not run simultaneously on every dashboard load.

**Root Cause:** Count queries using OData `$apply` are not surfaced by the current SDK abstraction. The team used full record fetches as a workaround.

**Business Impact:** The Admin Dashboard is the heaviest component in the application. Every time an Admin refreshes, they trigger up to 7,000 Dataverse API reads. In a 10-Admin environment with hourly refreshes, this is 70,000 reads/hour from this one component alone, approaching Power Platform API throttling limits.

**Recommended Solution:** Add a `count(filter?: string): Promise<number>` static method to each service class that calls `retrieveMultipleRecordsAsync` with `top: 1, select: ['<primarykey>']` and returns `result.data?.length ?? 0` (or uses a dedicated `$count` endpoint if the SDK supports it). Replace the bulk fetches in `AdminDashboard` with count calls for KPI metrics.

---

### F-019: Notification Polling at Fixed 30-Second Interval — No Backoff or SSE
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` `useNotifications()` lines 242–303, constant `NOTIF_POLL_MS = 30_000` |
| Category | Performance |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** `useNotifications` polls Dataverse every 30 seconds via `setInterval`. It correctly pauses on tab-hidden events (`visibilitychange`). There is no exponential backoff on failure, no jitter to prevent thundering-herd when multiple sessions start simultaneously, and no server-sent event (SSE) or WebSocket alternative.

**Expected Implementation:** (1) Add exponential backoff: on consecutive failures, double the poll interval up to a maximum of 5 minutes. Reset to 30 seconds on success. (2) Add ±5-second random jitter to the interval to desynchronise multiple browser sessions. (3) For the Power Platform context, evaluate Power Automate + Teams Adaptive Cards as a push notification alternative that eliminates polling entirely for critical notifications. (4) If polling must be retained, increase the default interval to 60 seconds and document the trade-off.

**Root Cause:** 30-second polling was chosen as a reasonable default. Backoff logic was not added.

**Business Impact:** With 100 concurrent active users, the platform generates 100 × 2 (polls/minute) = 200 Dataverse API calls/minute solely for notification polling. At scale this contributes meaningfully to Power Platform API throttle consumption and Dataverse service unit costs.

**Recommended Solution:** Implement exponential backoff in `useNotifications` by tracking `failureCount` in a ref. Add jitter: `NOTIF_POLL_MS + Math.random() * 10000 - 5000`. Document the steady-state API call rate in the operational runbook.

---

### F-020: `useChanges` and `useChangeList` Are Duplicate Data-Fetching Hooks
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` lines 67–183 (`useChanges`) and 305–335 (`useChangeList`) |
| Category | Performance |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** Two separate hooks fetch `cgmp_changes` records: `useChanges` (top: 1000, minimal select columns, used by Dashboard) and `useChangeList` (top: 500, extended select with 20 columns, used by PMO, ITOps, ISM, GIICC, Header search, RightPanel). These hooks have different column selections and different `top:` limits. Components that need both dashboard stats and the full change list (e.g., the Dashboard also imports change data via `recentChanges`) create two independent Dataverse calls. Additionally, `Header.tsx` mounts a `SearchDataProvider` component that calls `useChangeList()` and `useProjects()` — a third independent fetch of the same data once search is activated.

**Expected Implementation:** A single shared data layer should own the canonical list of changes. Options: (1) Promote `useChangeList` to a React context (similar to `UserProfilesContext`) that is initialised once at app load and shared across all consumers. (2) Adopt TanStack Query (`@tanstack/react-query`) with a single `queryKey: ['changes']` that all hooks share — TanStack Query deduplicates in-flight requests automatically. (3) At minimum, eliminate `useChanges` and have the Dashboard derive its stats from the same `useChangeList` data.

**Root Cause:** Each hook was written to serve a specific component's needs with no global data-sharing strategy. The architecture predates the introduction of `UserProfilesContext` as a shared-data pattern.

**Business Impact:** A user on the Dashboard simultaneously triggers a top-1000 query (`useChanges`) and a top-500 query (`useChangeList` via RightPanel). Activating search adds a third. Three Dataverse queries for the same entity on initial page load is a material performance cost.

**Recommended Solution:** Create a `ChangesContext` mirroring the `UserProfilesContext` pattern, fetching top-1000 with the full column set. Have both `useChanges` and `useChangeList` read from context instead of firing independent queries. Total reduction: from N queries to 1 per session refresh cycle.

---

### F-021: ISMWorkspace Bypasses `UserProfilesContext` — Fires Redundant Profile Fetch
| Field | Value |
|-------|-------|
| Module | `src/components/ism/ISMWorkspace.tsx` lines 83–87 |
| Category | Performance |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** `ISMWorkspace` imports and calls `Cgmp_userprofilesService.getAll({ top: 500 })` directly in a `useEffect` (line 83–87) to populate `userProfilesCacheRef` for sending concern notifications. `UserProfilesContext` already fetches the same 500 records on app initialisation. This creates a duplicate fetch every time the ISM Workspace mounts.

**Expected Implementation:** Replace the direct service call with `const { userProfiles } = useUserProfiles()`. The ref population (`userProfilesCacheRef.current = userProfiles`) can be done in a `useEffect` watching `userProfiles`.

**Root Cause:** The `UserProfilesContext` was added after the ISM concern notification feature was implemented. The direct fetch was not removed.

**Business Impact:** Every ISM Workspace mount triggers an additional 500-record Dataverse query. In a session where the user navigates away and back, this fires multiple times.

**Recommended Solution:** Replace lines 83–87 in `ISMWorkspace.tsx` with `const { userProfiles } = useUserProfiles()` and update `userProfilesCacheRef.current` in a `useEffect([userProfiles])`.

---

### F-022: ISM Project Identification Dual-Tracks GUID and Display-Name Fields
| Field | Value |
|-------|-------|
| Module | `src/components/ism/ISMWorkspace.tsx` lines 140–149, `src/generated/models/Cgmp_projectsModel.ts` (`cgmp_primaryism`, `cgmp_primaryismid`) |
| Category | Architecture |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** `cgmp_projects` has both `cgmp_primaryism` (string display name, documented as "legacy") and `cgmp_primaryismid` (GUID). The `ismProjects` filter in ISMWorkspace uses the GUID when available but falls back to display-name comparison: `p.cgmp_primaryismid === userId : p.cgmp_primaryism === ismUserName`. This means projects with only the legacy `cgmp_primaryism` field populated but no GUID will not appear in the ISM's project list if their `cgmp_userprofileid` is loaded.

**Expected Implementation:** All projects should be migrated to use only `cgmp_primaryismid`. A one-time Power Automate migration flow should match `cgmp_primaryism` display names to `cgmp_userprofileid` GUIDs and populate `cgmp_primaryismid` for all existing records. Once migrated, remove the fallback display-name comparison. Similarly, `cgmp_backupismid` should be authoritative for the backup ISM.

**Root Cause:** The GUID field (`cgmp_primaryismid`) was added after initial deployment when display-name-based matching proved fragile. The legacy field was retained for backward compatibility without a migration timeline.

**Business Impact:** ISMs with newly assigned projects may not see them if the project record was created before the GUID field was introduced. Conversely, if a user's display name changes, their projects would silently disappear from the ISM Workspace under the fallback path.

**Recommended Solution:** Run a migration flow: match `cgmp_primaryism` to `cgmp_userprofiles.cgmp_userprincipalname` (or display name) and populate `cgmp_primaryismid`. Set a cutoff date after which only GUID-based matching is used in the application code.

---

### F-023: DataTable Component Has No Row Virtualisation
| Field | Value |
|-------|-------|
| Module | `src/components/ui/DataTable.tsx` |
| Category | Performance |
| Priority | High |
| Complexity | High |

**Current Implementation:** The `DataTable` component renders all rows into the DOM simultaneously. With `useChangeList` fetching up to 500 records and `useChanges` fetching up to 1000, the PMO Workspace, ITOps Workspace, and ISM Workspace can render 500+ `<tr>` elements at once. Each row contains multiple status badges, date formatters, and inline SVG risk icons.

**Expected Implementation:** Implement virtual scrolling using either a custom windowed list (render only rows in and near the viewport) or a lightweight library such as TanStack Virtual (`@tanstack/react-virtual`). The DataTable should accept a `virtualise?: boolean` prop that enables windowing for tables exceeding a configurable threshold (e.g., 100 rows).

**Root Cause:** The DataTable was built for correctness and feature completeness. Virtualisation was deferred.

**Business Impact:** In a Chrome profiling run on a 500-row PMO list, initial render time can exceed 2 seconds on mid-range hardware. Scrolling performance degrades as the DOM holds thousands of nodes. Memory consumption increases proportionally with row count.

**Recommended Solution:** Install `@tanstack/react-virtual`. Wrap the DataTable tbody in a virtualised scroll container that estimates row height (approximately 48px per row) and renders only the visible window plus 10-row overscan. The DataTable API surface does not need to change for consuming components.

---

### F-024: No Unit, Integration, or End-to-End Tests Exist
| Field | Value |
|-------|-------|
| Module | Repository root — no `*.test.ts`, `*.spec.ts`, Playwright, Vitest, or Jest configuration files |
| Category | Operational Excellence |
| Priority | Critical |
| Complexity | High |

**Current Implementation:** There are zero automated tests in the repository. `package.json` has no `test` script. No test runner (Vitest, Jest, Playwright, Cypress) is configured. The `eslint-plugin-jsx-a11y` and `eslint-plugin-react-hooks` ESLint plugins provide some static analysis, but there are no runtime behaviour assertions.

**Expected Implementation:** Minimum viable test coverage for production: (1) Unit tests for all pure utility functions in `src/utils/` — `calcSLA`, `appendHistory`, `canTransition`, `getAllowedTransitions`, `formatDueDelta`, `isIsmFrozen`, `escapeODataString`. (2) Unit tests for the RBAC role-transition matrix (all 8 roles × all 11 statuses). (3) Component tests (Vitest + React Testing Library) for `ChangeForm` validation logic, `ErrorBoundary` rendering, and `SessionExpiredBanner` display conditions. (4) E2E smoke tests (Playwright) for the critical path: login → create change → review → release → complete.

**Root Cause:** The Power Apps Code App pattern is relatively new and the team may have prioritised feature velocity over test coverage. The absence of a CI pipeline also removes the enforcement mechanism for test requirements.

**Business Impact:** Any refactoring of `roles.ts`, `business.ts`, or `ChangeForm.tsx` risks undetected regressions in the state machine. The concurrent-edit, rescue-draft, and blackout-conflict features are particularly fragile without test coverage.

**Recommended Solution:** Configure Vitest with `@testing-library/react` and `@testing-library/user-event`. Start with pure function unit tests (zero mocking needed for `utils/`). Add a `test` script to `package.json`. Target 60% coverage within 4 weeks, focusing on the state machine and form validation logic.

---

### F-025: No CI/CD Pipeline Exists
| Field | Value |
|-------|-------|
| Module | Repository root — no `.github/workflows/`, `azure-pipelines.yml`, or equivalent |
| Category | Operational Excellence |
| Priority | Critical |
| Complexity | Medium |

**Current Implementation:** Deployment is performed via PowerShell scripts (`scripts/deploy-app.ps1`, `scripts/deploy-schema.ps1`). There is no automated pipeline that runs on push/merge. No automated lint, type-check, build, or test gate prevents broken code from reaching production.

**Expected Implementation:** A CI/CD pipeline (GitHub Actions or Azure DevOps) should: (1) On every PR: run `tsc -b`, `eslint .`, and `npm test` with a failing gate. (2) On merge to `main`: run the build (`vite build`), package the Power Apps solution (`pac solution pack`), and deploy to a staging environment. (3) On manual approval: promote the staged solution to production. (4) Capture build artifacts (the `dist/` bundle) and tag them with the version.

**Root Cause:** The project was bootstrapped as a local development effort. CI/CD was not established from the outset.

**Business Impact:** Without a CI gate, type errors, broken imports, and lint failures can be committed and deployed to production. Without automated deployment, the release process is manual, error-prone, and unaudited.

**Recommended Solution:** Create `.github/workflows/ci.yml` with steps: `actions/checkout`, `actions/setup-node`, `npm ci`, `npm run build`, `npm run lint`. Add a `.github/workflows/deploy.yml` with `pac solution pack` and Power Platform CLI deployment steps. Use GitHub Environments for staging/production promotion gates.

---

### F-026: ChangeForm.tsx Exceeds 1,200 Lines — Violates Single Responsibility
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` (approximately 1,200+ lines) |
| Category | Technical Debt |
| Priority | High |
| Complexity | High |

**Current Implementation:** `ChangeForm.tsx` contains: the `FormState` type and `blankForm`/`fromChange`/`validate` functions; the `ReadField`, `HelpTip`, `VersionHistory`, `CommentsSection`, and `RelatedKBArticles` sub-components; the `ChangeForm` component itself with 20+ `useState`/`useEffect` hooks covering form state, auto-save, draft management, concurrent edit detection, reschedule proposal acceptance, blackout checking, scheduling conflict detection, and navigation guards; and the full JSX render tree for both view mode and edit/create mode.

**Expected Implementation:** Split into: (1) `src/components/pmo/changeform/ChangeFormCore.tsx` — main form component (state, validation, save logic). (2) `src/components/pmo/changeform/VersionHistory.tsx` — version history display. (3) `src/components/pmo/changeform/CommentsSection.tsx` — comment thread. (4) `src/components/pmo/changeform/RelatedKBArticles.tsx` — KB article linking. (5) `src/components/pmo/changeform/RescheduleSection.tsx` — reschedule proposal display and accept/decline. (6) `src/hooks/useChangeAutoSave.ts` — auto-save logic. (7) `src/hooks/useDraftRestore.ts` — draft management. (8) `src/hooks/useConcurrentEditDetect.ts` — concurrent edit advisory.

**Root Cause:** The form grew organically as features were added. Each feature was appended to the existing file rather than extracted.

**Business Impact:** The 1,200-line component is difficult to test, review, and maintain. A bug in the comment-deletion logic requires parsing the entire file. New contributors face a steep onboarding curve. Bundle analysis tools cannot tree-shake sub-components that never change.

**Recommended Solution:** Begin with the lowest-coupling extractions: move `CommentsSection`, `VersionHistory`, and `RelatedKBArticles` to their own files. Then extract `useChangeAutoSave` and `useDraftRestore` as custom hooks. Leave the main form component at a target of 400 lines.

---

### F-027: `as any` and `as unknown as` Type Casts Throughout Service Calls
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 693–703, 746–769, 855–866; `src/context/AppContext.tsx` lines 138–146; `src/components/giicc/PIRForm.tsx` line 62 |
| Category | Technical Debt |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** Service call payloads and audit log creation use `as any`, `as unknown as Cgmp_auditlogscgmp_entitytype`, and `as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>` casts throughout. Option-set numeric codes (e.g., `100000000 as unknown as Cgmp_changescgmp_status`) are cast because the generated model types the fields as `keyof typeof Enum` (the string key) rather than as `number`. The `ChangeForm.handleSave()` builds the base payload `as any` (line 769) to avoid TypeScript errors on numeric option-set assignments.

**Expected Implementation:** The generated model should be modified (or the service method signatures updated) so that option-set fields accept `number` as well as the strongly-typed enum key. A union type `Cgmp_changescgmp_status | number` on the model interface would allow numeric codes to be passed without casting. Alternatively, a type-safe factory function `statusCode(n: number): Cgmp_changescgmp_status { return n as Cgmp_changescgmp_status; }` centralises the cast.

**Root Cause:** The PAC modelbuilder generates TypeScript types where option-set fields are typed as `keyof typeof EnumObject` (which resolves to the numeric string keys like `"100000000"`) rather than `number`. The application uses raw numbers from `STATUS`, `ROLES` and similar constants, creating a type mismatch.

**Business Impact:** Type safety is reduced at the most critical write boundaries — the service calls that actually mutate Dataverse. Runtime errors from incorrect field values will not be caught at compile time.

**Recommended Solution:** Create `src/utils/optionSets.ts` with type-safe cast helpers: `export function asStatus(n: number): Cgmp_changescgmp_status { return n as Cgmp_changescgmp_status; }`. Replace all inline `as unknown as` casts with these helpers. Add a custom ESLint rule or TSConfig `no-any: error` to prevent new `as any` casts without a suppression comment.

---

### F-028: `HistoryEntry` and Reschedule Payload Types Are `any`
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 153–160, 929–938, 941–1009 |
| Category | Technical Debt |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** The `HistoryEntry` interface (line 153) has `previousValues?: Record<string, unknown>` and `newValues?: Record<string, unknown>` which are adequately typed. However, the reschedule proposal reading/writing uses `any[]` for `hist` (lines 931, 947) and the proposal objects are typed as `any` in `handleAcceptReschedule` and `handleDeclineReschedule`. Accesses like `proposal.timestamp`, `proposal.proposedStart`, `proposal.by` are untyped.

**Expected Implementation:** Define a discriminated union type for all history entry subtypes: `type HistoryEntryUnion = EditEntry | CommentEntry | RescheduleProposedEntry | RescheduleAcceptedEntry | RescheduleDeclinedEntry | MttrEntry`. Each subtype has a literal `_type` discriminant and fully typed fields. The `hist` array should be `HistoryEntryUnion[]`.

**Root Cause:** The reschedule feature was added rapidly with typed stubs deferred to a future pass.

**Business Impact:** A typo in `proposal.proposedStart` vs `proposal.proposedstart` would not be caught at compile time and would silently produce `undefined` values in the reschedule acceptance flow.

**Recommended Solution:** Define the discriminated union in a shared file (e.g., `src/types/changeHistory.ts`) and import it wherever `cgmp_versionhistory` is parsed. The migration to a proper `cgmp_changehistory` table (F-009) would make this type available throughout the codebase.

---

### F-029: Inline Comment Delete Uses Soft-Delete via `_type: 'comment_deleted'` — Not Purged
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` `deleteComment()` lines 328–339 |
| Category | Technical Debt |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** `deleteComment()` patches the history array by replacing the comment entry's `_type` from `'comment'` to `'comment_deleted'` (cast as `unknown as HistoryEntry`). The `CommentsSection` component then renders only entries where `e._type === 'comment'`, effectively hiding deleted comments. However, the raw JSON in `cgmp_versionhistory` still contains the deleted comment's text, which is visible to anyone who queries the field directly from Dataverse or the Power Apps maker portal.

**Expected Implementation:** If deleted comments must not be recoverable, the patch should replace the comment object with `{ _type: 'comment_deleted', timestamp: c.timestamp, deletedBy: currentUser, deletedAt: new Date().toISOString() }` — preserving the audit record of the deletion without retaining the comment text. Alternatively, use a hard delete by filtering the entry out entirely.

**Root Cause:** Soft-delete was implemented to preserve audit trail continuity without full history reconstruction.

**Business Impact:** A potentially defamatory or compliance-sensitive comment deleted by the author remains in plaintext in the Dataverse field. An Admin querying the field directly can read "deleted" comments.

**Recommended Solution:** Replace the comment content with a tombstone: `{ _type: 'comment_deleted', timestamp: orig.timestamp, deletedBy: currentUser }`. Omit `comment` text from the tombstone entry. Update the renderer to show "Comment deleted by [user]" for tombstone entries rather than hiding them entirely.

---

### F-030: SessionExpiredBanner Checks `sessionStorage.getItem('cgmp-session-expired') === 'true'` but Value Stored is `'1'`
| Field | Value |
|-------|-------|
| Module | `src/components/ui/SessionExpiredBanner.tsx` line 10; `src/generated/services/Cgmp_changesService.ts` line 90 |
| Category | Bug |
| Priority | High |
| Complexity | Low |

**Current Implementation:** In `Cgmp_changesService.ts`, `dispatchSessionExpiry()` writes `sessionStorage.setItem('cgmp-session-expired', '1')`. In `SessionExpiredBanner.tsx`, the mount-time check reads `sessionStorage.getItem('cgmp-session-expired') === 'true'`. Because `'1' !== 'true'`, the banner will **never** display on initial mount if the session expired in a previous page-load cycle. The banner only shows via the `CustomEvent` path, which requires the current page's JavaScript to still be running when the expiry event fires.

**Expected Implementation:** Either store `'true'` (to match the banner check) or change the banner check to `=== '1'`. The consistent approach is to use a boolean-like convention across the codebase and document it. Given `'1'` is already written by the service, change the banner check to `sessionStorage.getItem('cgmp-session-expired') === '1'`.

**Root Cause:** A simple string inconsistency between the writer (service) and the reader (banner component) introduced during separate development sessions.

**Business Impact:** When a user's session expires and they navigate to a new page (full reload), the `SessionExpiredBanner` silently fails to appear on mount. The user is not prompted to sign in and will receive cryptic errors from all subsequent API calls.

**Recommended Solution:** Change line 10 of `SessionExpiredBanner.tsx` from `=== 'true'` to `=== '1'`. Add a typed constant: `export const SESSION_EXPIRED_KEY = 'cgmp-session-expired'; export const SESSION_EXPIRED_VALUE = '1';` and import it in both the service and the banner component.

---

### F-031: Logout Audit Log Written in `beforeunload` — Unreliable
| Field | Value |
|-------|-------|
| Module | `src/context/AppContext.tsx` lines 131–149 |
| Category | Bug |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** The `beforeunload` event handler fires `Cgmp_auditlogsService.create()` (an async fetch) to record the logout event. Modern browsers severely constrain XHR/fetch calls in `beforeunload` handlers: they may be aborted before completion, especially on mobile browsers and when closing a tab. The fetch is fire-and-forget with `.catch(() => {})` so failures are silently swallowed.

**Expected Implementation:** Use the Beacon API (`navigator.sendBeacon()`) for the logout audit log. The Beacon API is explicitly designed for fire-and-forget telemetry on page unload and is not subject to the same completion guarantees as `fetch`. Alternatively, record logout on the next page load by checking `performance.navigation.type === 'reload'` and persisting the logout marker in sessionStorage from `beforeunload`.

**Root Cause:** The `Cgmp_auditlogsService.create()` API is async and wraps the Power Apps SDK client — it cannot be easily converted to a synchronous `sendBeacon` call without a custom Dataverse Web API endpoint.

**Business Impact:** Logout audit events are intermittently missing from the audit log, creating gaps in the user session history. This may be a compliance concern for regulated environments.

**Recommended Solution:** Implement a Power Automate HTTP-triggered flow that accepts a minimal logout payload (UPN, timestamp, browser). Call this endpoint via `navigator.sendBeacon()` in the `beforeunload` handler. The flow writes the audit log to Dataverse asynchronously. This bypasses the SDK client limitation.

---

### F-032: Navigation Guard Uses `window.confirm()` — Blocked in Many Enterprise Environments
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 920–927 |
| Category | UI/UX |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** The navigation guard (`setNavigationGuard`) uses `window.confirm('You have unsaved changes. Leave without saving?')`. Many enterprise environments (Microsoft Edge managed deployments, Citrix browser sessions, and headless browser environments) suppress or auto-dismiss `window.confirm()` dialogs, causing the guard to pass silently. Teams-embedded web views may also behave differently.

**Expected Implementation:** Replace `window.confirm` with a custom React `ConfirmDialog` component (already implemented in the codebase at `src/components/ui/ConfirmDialog.tsx`). The `setNavigationGuard` callback should be able to return a `Promise<boolean>` so that an async modal confirmation can be awaited before navigation proceeds.

**Root Cause:** `window.confirm` was used for implementation simplicity since the navigation guard runs outside of React's render tree (it's checked in the `navigate` callback).

**Business Impact:** Users in enterprise browser environments lose the unsaved changes warning, leading to accidental data loss on navigation. This is particularly impactful during complex change creation where multiple fields have been filled.

**Recommended Solution:** Convert `setNavigationGuard` to accept a `() => Promise<boolean>` guard type. Render a `ConfirmDialog` in `ChangeForm` and expose a resolution mechanism (a `Promise` resolver ref) that the guard callback awaits. This requires refactoring the `AppContext.navigate` function to `async`.

---

### F-033: `window.confirm()` Also Used for Blackout Period Override
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` line 741 |
| Category | UI/UX |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** The blackout period override confirmation uses `window.confirm(...)` at line 741. The same enterprise browser suppression issues from F-032 apply here. Additionally, `window.confirm` returns `true` when suppressed, meaning the confirmation is bypassed rather than blocked.

**Expected Implementation:** Replace with the existing `ConfirmDialog` component. Show the blackout period name, the date range, and a prominent warning before proceeding. Log an audit event when the override is confirmed.

**Root Cause:** Consistent with F-032 — `window.confirm` was used for speed.

**Business Impact:** When `window.confirm` is suppressed (returns `true` by default), any change with a date falling in a blackout period will be saved without the intended human confirmation step. This bypasses a key governance control.

**Recommended Solution:** Move the blackout-period confirmation into a `ConfirmDialog` modal with the blackout period details displayed. Make the "Proceed Anyway" button distinctively coloured (danger red). Record an audit log entry with the blackout name and the user who overrode it.

---

### F-034: DataTable Row Selection Not Keyboard-Accessible
| Field | Value |
|-------|-------|
| Module | `src/components/ui/DataTable.tsx` |
| Category | Accessibility (WCAG) |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** The DataTable's checkboxes and row-click selection are implemented with mouse-event handlers. The table does not implement `role="grid"` or `role="row"` for keyboard navigation. Row selection via keyboard (Space to select, Shift+Click equivalent via keyboard) is not implemented. The bulk-action toolbar that appears on selection is not announced to screen readers via `aria-live`.

**Expected Implementation:** WCAG 2.1 Level AA requires that all functionality achievable by mouse is also achievable by keyboard. Implement `role="grid"` on the table, `role="row"` on `<tr>` elements, and `role="gridcell"` on `<td>`. Row selection via Space key should toggle the checkbox. Arrow keys should navigate between rows. The bulk-action toolbar appearance should be announced: `<div aria-live="polite" aria-atomic="true">` announcing the selected count.

**Root Cause:** The DataTable was built primarily for desktop mouse usage. Accessibility was partially addressed (ARIA attributes on the table element) but not on individual rows.

**Business Impact:** Users who rely on keyboard navigation (motor disabilities) or screen readers cannot use the bulk-select functionality in the PMO, ITOps, or ISM workspaces. This may constitute a WCAG 2.1 Level AA compliance failure under applicable accessibility laws (Section 508, EN 301 549).

**Recommended Solution:** Add keyboard event handlers to table rows: `onKeyDown={(e) => { if (e.key === ' ') toggleSelect(row.id); }}`. Add `tabIndex={0}` to `<tr>` elements. Implement `role="grid"` on the `<table>` and `role="row"` on `<tr>`. Add `<div role="status" aria-live="polite">` for the selection count announcement.

---

### F-035: Form Validation Errors Not Announced to Screen Readers
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` `validate()` function; `src/components/ui/FormFields.tsx` |
| Category | Accessibility (WCAG) |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** Form validation in `ChangeForm` runs on `handleSave()` and populates an `errors` record which is passed to individual field components. The `Field` component in `FormFields.tsx` renders the error message as text below the input. However, when validation errors appear, focus is not moved to the first error, and no `aria-live` region announces that errors have occurred. A screen reader user who activates the Save button hears nothing to indicate validation failed.

**Expected Implementation:** (1) Add `aria-invalid="true"` to inputs that have validation errors. (2) Add `aria-describedby` linking the input to its error message element. (3) After validation runs and errors are found, move focus to the first invalid field using a `useEffect`. (4) Add an `aria-live="assertive"` summary region at the top of the form: "Form has [N] errors. Please review the highlighted fields."

**Root Cause:** The validation and error-display mechanism was built for visual users. ARIA annotations for screen readers were not included.

**Business Impact:** Screen reader users cannot determine that their form submission failed or which fields require correction. This fails WCAG 2.1 Success Criterion 3.3.1 (Error Identification) and 3.3.3 (Error Suggestion) at Level AA.

**Recommended Solution:** Update `FormFields.tsx` `Field` component: add `aria-invalid={!!error}` and `aria-describedby={error ? \`\${fieldId}-error\` : undefined}` to the input. Give error message elements `id={\`\${fieldId}-error\`}`. In `ChangeForm`, after `setErrors(errs)` where `errs` is non-empty, schedule a `useEffect` to focus the first invalid field.

---

### F-036: SVG Charts Lack `<desc>` Elements and Data Table Alternatives
| Field | Value |
|-------|-------|
| Module | `src/components/Dashboard.tsx` `LineChart`, `DonutChart`; `src/components/modules/Reports.tsx` `BarChart` |
| Category | Accessibility (WCAG) |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** The `LineChart` component has `role="img"` and `<title>Change trend over time</title>`. The `DonutChart` has `role="img"` and an `aria-label` with bucket counts. Neither has a `<desc>` element providing a textual summary of the data for screen readers. No component provides an HTML data table alternative that screen reader users can navigate.

**Expected Implementation:** WCAG 2.1 Success Criterion 1.1.1 (Non-text Content) requires a text alternative for complex images. For charts: (1) Add `<desc id="chart-desc-[id]">` inside each SVG with a human-readable summary (e.g., "Over the past 7 days, 23 changes were created, 18 completed, and 2 failed. Peak creation was on Jul 8 with 7 changes."). (2) Add an `aria-describedby` attribute on the `<svg>` pointing to the `<desc>` ID. (3) Add a visually-hidden `<table>` with the chart data as an accessible fallback.

**Root Cause:** Basic ARIA attributes were added but the deeper accessibility requirements for complex data visualisations were not fully addressed.

**Business Impact:** Screen reader users (including those using NVDA or JAWS with Internet Explorer compatibility mode in Citrix environments) cannot access dashboard analytics data. Charts are announced as empty images.

**Recommended Solution:** Add a `generateChartDescription(data)` function for each chart type that produces a descriptive sentence. Inject it as `<desc>`. Optionally add a "View as table" toggle that reveals a visually-hidden summary table for data consumers.

---

### F-037: Sidebar Tooltip Labels Missing ARIA Attributes in Collapsed State
| Field | Value |
|-------|-------|
| Module | `src/components/Sidebar.tsx` lines 145–152 |
| Category | Accessibility (WCAG) |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** In collapsed state, each sidebar button renders `<span className="sidebar__tooltip">{item.label}</span>` as a CSS-positioned tooltip. This tooltip is pure CSS (`visibility: hidden` transitioning to `visible` on hover). Screen readers will read the button content and the hidden span simultaneously, potentially announcing the label twice or not at all depending on the CSS implementation.

**Expected Implementation:** Add `title={item.label}` to the button element in collapsed state (for tooltip display via browser native mechanism). Add `aria-label={item.label}` to the button. Remove the CSS tooltip `<span>` from the accessibility tree using `aria-hidden="true"`. The button in collapsed mode should have no children visible to the accessibility tree except the SVG icon (which should itself be `aria-hidden`).

**Root Cause:** The CSS tooltip approach is common but requires careful ARIA annotation to avoid duplicate announcements.

**Business Impact:** Screen reader users navigating the collapsed sidebar may hear "Dashboard Dashboard" or just "Dashboard" depending on the browser. The experience is inconsistent across assistive technologies.

**Recommended Solution:** Add `aria-hidden="true"` to `<span className="sidebar__tooltip">`. Ensure buttons have `aria-label={item.label}` applied unconditionally (not just in collapsed state) so the label is always available to screen readers.

---

### F-038: Right Panel Quick Filters Use Emoji as Primary Identifier
| Field | Value |
|-------|-------|
| Module | `src/components/RightPanel.tsx` `QUICK_FILTERS` constant, lines 8–17 |
| Category | Accessibility (WCAG) |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** Quick filters in the Right Panel use emoji icons (`'📅'`, `'⚠'`, `'✕'`, etc.) as the first character of the label. These emoji are read aloud by screen readers with verbose platform-specific descriptions (e.g., "calendar emoji, Today's Changes"). The `⚠` emoji reads differently across platforms and some older screen readers omit it entirely.

**Expected Implementation:** Replace emoji with inline SVG icons (consistent with the rest of the application). Wrap SVG icons in `<span aria-hidden="true">`. Ensure the button's text label is the only content read by screen readers.

**Root Cause:** Emoji were used as a quick design shortcut in the RightPanel, which is a secondary UI element.

**Business Impact:** Minor screen reader usability issue. Inconsistent with the rest of the shell which uses proper SVG icons with `aria-hidden`.

**Recommended Solution:** Replace the `icon: string` field in `QUICK_FILTERS` with `icon: React.ReactNode` and use the existing `Icon` component pattern from `Sidebar.tsx`. Each quick filter button should render `<Icon ... aria-hidden={true} />` followed by the text label.

---

### F-039: `useSystemUsers` Fetches 1,000 AAD Users Without Location or Role Filtering
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` `useSystemUsers()` lines 396–423 |
| Category | Performance |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** `useSystemUsers()` queries `SystemusersService.getAll({ filter: 'isdisabled eq false', orderBy: ['fullname asc'], top: 1000, select: [...] })`. In large enterprise deployments the Dataverse environment may contain thousands of system users (all AAD accounts with any Dataverse licence). Fetching 1,000 and filtering disabled accounts still loads the full page into memory before the picker renders.

**Expected Implementation:** The `useSystemUsers` hook is used for the "Tech POC" picker in `ChangeForm`. The picker should allow server-side search: as the user types, fire a debounced query `filter: "contains(fullname, '${query}')"` returning at most 10 results. This converts the upfront bulk-fetch into an on-demand search pattern. For the User Picker in `SecurityRoles` (where the full list may be needed for batch assignment), keep the bulk fetch but add a search-before-load pattern.

**Root Cause:** The picker was implemented with a pre-loaded dataset for a responsive typeahead experience, without considering the scale of the user directory.

**Business Impact:** In a 5,000-user Dataverse environment, the `useSystemUsers` hook returns data for 1,000 users per call, consuming 1–2 MB of API response bandwidth. Multiple workspaces mount this hook independently (ChangeForm, ITOpsWorkspace, SecurityRoles), potentially tripling the fetch.

**Recommended Solution:** Convert `useSystemUsers` to accept a `searchTerm?: string` parameter. When `searchTerm` is provided and has at least 2 characters, fetch a server-side filtered list. Use the `useDebounce` hook (already exported from `useDataverse`) to debounce the search term. Keep the existing full-fetch behaviour only when no search term is provided, or remove it entirely.

---

### F-040: `Reports.tsx` Builds All Charts In-Memory from Full Change Dataset
| Field | Value |
|-------|-------|
| Module | `src/components/modules/Reports.tsx` |
| Category | Performance |
| Priority | High |
| Complexity | High |

**Current Implementation:** The Reports module imports `useChangeList`, `useProjects`, and `useAllBridges` — fetching up to 500 changes, 500 projects, and 200 bridges — and then performs all aggregations (category counts, region groupings, status distributions, SLA calculations, bridge completion rates) using in-browser JavaScript array operations. Every filter change (date range picker, region selector) triggers a full re-aggregation across the entire in-memory dataset. No server-side aggregation is used.

**Expected Implementation:** Report aggregations should be computed server-side using Dataverse OData `$apply` aggregation: `$apply=filter(createdon ge 2026-01-01T00:00:00Z)/groupby((cgmp_status),aggregate($count as count))`. This returns only the aggregate result rather than all raw records. For historical trend reports, use Power BI embedded (the `powerbi` workspace already exists) or implement a Dataverse FetchXML aggregate query via the Web API.

**Root Cause:** The OData `$apply` syntax is not surfaced through the current Power Apps SDK abstraction. The team used client-side aggregation as the accessible alternative.

**Business Impact:** The Reports module's performance degrades proportionally with the number of changes. At 1,000 changes with a 90-day date range and multiple filter selections, the page will freeze for several seconds during re-aggregation on slow devices.

**Recommended Solution:** Short-term: memoize all derived aggregations using `useMemo` keyed on the date range and the underlying data array — currently, filter-change re-runs un-memoised reduce operations. Long-term: replace client-side aggregation with a custom Dataverse Web API call using `$apply` for each chart's data needs. Consider creating a Power BI workspace with pre-built aggregation reports and embedding it via the existing `powerbi` module.

---

### F-041: Application Insights AJAX and Fetch Tracking Disabled
| Field | Value |
|-------|-------|
| Module | `src/utils/appInsights.ts` lines 15–16 |
| Category | Operational Excellence |
| Priority | High |
| Complexity | Low |

**Current Implementation:** The Application Insights configuration sets `disableAjaxTracking: true` and `disableFetchTracking: true`. This disables automatic collection of all HTTP/fetch dependency telemetry, which is the primary source of API performance data (response times, failure rates, dependency maps). Only manual `trackEvent` and `trackException` calls are active.

**Expected Implementation:** Enable `disableFetchTracking: false` (the default). This automatically captures all `fetch()` calls including Dataverse API requests, with response times, status codes, and URLs. Use the `addRequestHeaders` configuration to add correlation headers. If specific endpoints should be excluded (e.g., telemetry self-ingestion) use `excludeRequestFromAutoTrackingPatterns`.

**Root Cause:** The `disableFetchTracking` flag was set to `true` during initial development, possibly to reduce noise from Dataverse polling. The flag was not revisited for production.

**Business Impact:** Without fetch tracking, the operations team has no visibility into Dataverse API latency, error rates, or throttling incidents from Application Insights. Performance regressions after deployments are invisible unless users report them. The Application Map in Azure Application Insights will show no dependencies.

**Recommended Solution:** Set `disableFetchTracking: false` in `initAppInsights()`. Add `excludeRequestFromAutoTrackingPatterns: [/dc\.services\.visualstudio\.com/]` to exclude AI self-calls. Implement sampling (`samplingPercentage: 20`) to limit telemetry volume from the 30-second notification polls.

---

### F-042: App Insights Connection String Storable in `localStorage` — Security Risk
| Field | Value |
|-------|-------|
| Module | `src/utils/appInsights.ts` lines 6–23; `src/components/settings/Settings.tsx` |
| Category | Security |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** `initAppInsights()` accepts a connection string from `localStorage` key `cgmp-ai-connection-string` as a fallback when `VITE_APPINSIGHTS_CS` is not set. `configureAppInsights()` can be called at runtime to set the connection string and persists it to localStorage. This means any user with console access can inject their own App Insights connection string, redirecting telemetry to their own Azure subscription.

**Expected Implementation:** The App Insights connection string should be a build-time environment variable only (`VITE_APPINSIGHTS_CS`). Runtime configuration via localStorage should be removed. For Admin-driven runtime configuration, store the connection string in a Dataverse `cgmp_applicationsettings` record (Admin-write-only) and load it with the app initialisation profile fetch.

**Root Cause:** The localStorage fallback was added to support runtime configuration during early deployment where build environment was not fully controlled.

**Business Impact:** A malicious user could redirect all telemetry (including user UPNs set via `setUser()`) to a third-party Application Insights instance, constituting a data exfiltration path for user identity information.

**Recommended Solution:** Remove the `localStorage.getItem(INSTRUMENTATION_KEY_LS)` fallback from `initAppInsights()`. Remove `configureAppInsights()` from the public API or restrict it to development builds (`import.meta.env.DEV` only). Ensure `VITE_APPINSIGHTS_CS` is set in all deployment environments.

---

### F-043: `cgmp_uatusers` on Both Changes and Projects Stored as String Blobs
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts` (`cgmp_uatusers?: string`), `src/generated/models/Cgmp_projectsModel.ts` (`cgmp_uatusers?: string`), `src/components/giicc/GIICCCommandCenter.tsx` `parseChangeUATData()` |
| Category | Architecture |
| Priority | High |
| Complexity | High |

**Current Implementation:** `cgmp_uatusers` on `cgmp_changes` stores a JSON blob of type `ChangeUATData` — a complex nested structure with per-project UAT contacts, pre/post status, failure reasons, rollback flags, remediation history, and RCA entries. `cgmp_uatusers` on `cgmp_projects` stores a semicolon-separated list of contact strings. The `parseChangeUATData()` function parses the JSON on every render. No schema validation is applied to the blob.

**Expected Implementation:** The `ChangeUATData` structure should be normalised into a `cgmp_uatcontacts` Dataverse table with fields: `cgmp_changeid` (lookup), `cgmp_projectid` (lookup), `cgmp_contactname`, `cgmp_contactemail`, `cgmp_contactphone`, `cgmp_prestatus` (option set), `cgmp_poststatus` (option set), `cgmp_comments`, `cgmp_failurereason`, `cgmp_rollback` (boolean). Remediation history should move to `cgmp_remediationhistory` table. This enables querying "all failed UAT contacts across all changes in Q3" via OData rather than full-table-scan + client-side JSON parsing.

**Root Cause:** The UAT data model evolved organically from a simple contact list to a complex remediation tracking system. Each addition was appended to the JSON blob rather than modelled as a new Dataverse table.

**Business Impact:** The `cgmp_uatusers` blob on a heavily-used change can grow to 50KB or more as remediation history accumulates. This approaches the Dataverse text column size limit (1MB). Querying UAT contact failure rates across changes requires loading all change records and parsing each blob individually — a multi-second operation at scale.

**Recommended Solution:** Phase 1: define the `cgmp_uatcontacts` and `cgmp_remediationhistory` tables in the Dataverse solution. Phase 2: write a migration Power Automate flow that parses existing blobs and creates the normalised records. Phase 3: update `GIICCCommandCenter` and `ISMWorkspace` to use `$expand` for UAT contacts rather than `parseChangeUATData()`. Phase 4: deprecate `cgmp_uatusers` field.

---

### F-044: `cgmp_assignedlocations` on User Profiles Is a Semicolon-Delimited String
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_userprofilesModel.ts` (`cgmp_assignedlocations?: string`), `src/context/AppContext.tsx` lines 229–233 |
| Category | Architecture |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** A user's assigned locations are stored as a semicolon-delimited string (e.g., `"Singapore; Tokyo; Mumbai"`) in `cgmp_assignedlocations`. `AppContext` parses this on every render: `locs.split(';').map(l => l.trim()).filter(Boolean)`. Location-scoped queries (e.g., ITOps seeing only changes for their locations) depend on client-side filtering against this parsed array.

**Expected Implementation:** Assigned locations should be a proper N:M relationship between `cgmp_userprofiles` and a `cgmp_locations` lookup table. This would enable server-side filtering: `filter: "cgmp_userprofiles_cgmp_locations/any(l: l/cgmp_locationcode eq 'SG')"`. The `cgmp_locations` table would also centralise location data currently scattered as free-text strings across changes, projects, and user profiles.

**Root Cause:** A locations lookup table was not created during initial schema design. The semicolon-delimited string was a quick approximation.

**Business Impact:** Adding a new location requires finding and updating every user profile record manually. There is no enforcement that location strings are consistent across the application (e.g., "Singapore" vs "SINGAPORE" vs "SG"). ITOps location-scoped filtering is client-side and fails silently if locations don't match exactly.

**Recommended Solution:** Create a `cgmp_locations` Dataverse table. Migrate `cgmp_assignedlocations` to an N:M relationship. Update location pickers in `ChangeForm`, `SecurityRoles`, and the project editor to use a controlled lookup from `cgmp_locations`.

---

### F-045: `cgmp_attachmentids` on Changes Is an Unvalidated String Field
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts` (`cgmp_attachmentids?: string`), `src/components/ui/AttachmentPanel.tsx` (`loadAnnotations`, `downloadAnnotation`) |
| Category | Architecture |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** `cgmp_attachmentids` is a text field on `cgmp_changes`. The `AttachmentPanel` component uses the Dataverse `Annotations` entity (`AnnotationsService`) for actual file storage but the `cgmp_attachmentids` field appears to be a supplementary reference string. The `loadAnnotations` function queries `AnnotationsService` with `filter: \`objectid eq '${entityId}'\`` — using the Dataverse standard annotation-to-record relationship rather than the custom field. The purpose of `cgmp_attachmentids` as a separate field is unclear.

**Expected Implementation:** Dataverse natively supports file attachments via the `Annotations` (Notes) table with a polymorphic `objectid` lookup to any entity. The standard approach is to use `AnnotationsService` exclusively (which the `AttachmentPanel` already does for loading and downloading). The `cgmp_attachmentids` custom field appears redundant and should either be documented as serving a distinct purpose (e.g., external system attachment IDs) or removed.

**Root Cause:** The `cgmp_attachmentids` field may have been added to store external document management system (SharePoint, OneDrive) links alongside native Dataverse annotations. Without documentation, the intent is ambiguous.

**Business Impact:** If the field stores external attachment IDs but no rendering logic uses them, they are silently lost data. If the field duplicates native annotation IDs, it creates a maintenance burden to keep them in sync.

**Recommended Solution:** Document the intended use of `cgmp_attachmentids`. If it stores external SharePoint/OneDrive links, create a `cgmp_externalattachments` table with a proper lookup and URL field. If it is redundant with native annotations, deprecate and remove it from the schema.

---

### F-046: Magic Numeric Option-Set Codes Repeated Inline in Components
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 855, 862; `src/components/giicc/PIRForm.tsx` line 62; multiple workspace files |
| Category | Technical Debt |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** Despite a centralised `STATUS`, `ROLES`, `RISK`, and `BRIDGE_STATUS` constants file in `src/utils/roles.ts`, many components still use raw numeric literals inline: `100000000 as any` for status codes in notification creation calls, `100000001` for PMO role checks, `100000000 as Cgmp_notificationscgmp_category` for notification categories. There is no `NOTIFICATION_CATEGORY` or `NOTIFICATION_PRIORITY` constants object analogous to `STATUS`.

**Expected Implementation:** Add a `NOTIFICATION_CATEGORY`, `NOTIFICATION_PRIORITY`, `AUDIT_ENTITY_TYPE`, and `AUDIT_EVENT_TYPE` constants object to `src/utils/roles.ts` (or a new `src/utils/constants.ts`). Replace all inline numeric literals in notification and audit log creation with named constants. ESLint's `no-magic-numbers` rule should be enabled for `src/components/` and `src/hooks/`.

**Root Cause:** The notification and audit log option-set codes were not added to the central constants file when those features were implemented. Developers referenced the model enum values directly.

**Business Impact:** If a Dataverse option-set value changes (e.g., the "Emergency" notification category code is renumbered), the change must be tracked down across every inline usage. A grep for `100000005` returns matches from multiple unrelated contexts (notification priority Low, bridge status Scheduled, change status Locked) making the search unreliable.

**Recommended Solution:** Add to `src/utils/roles.ts`:
```typescript
export const NOTIFICATION_CATEGORY = {
  ReviewRequest: 100000000, UATReminder: 100000001, Escalation: 100000002,
  GIICCHandover: 100000003, Closure: 100000004, Emergency: 100000005, System: 100000006,
} as const;
export const NOTIFICATION_PRIORITY = { High: 100000000, Medium: 100000001, Low: 100000002 } as const;
```
Replace all inline uses. Enable `no-magic-numbers` ESLint rule with `ignore: [0, 1, -1]`.

---

### F-047: `calcSLA` Function Duplicated Between `business.ts` and `ISMWorkspace.tsx`
| Field | Value |
|-------|-------|
| Module | `src/utils/business.ts` line 36–41 (`export function calcSLA`), `src/components/ism/ISMWorkspace.tsx` lines 25–30 (local `function calcSLA`) |
| Category | Technical Debt |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** `calcSLA` is defined in `src/utils/business.ts` and exported. However, `ISMWorkspace.tsx` defines its own local `calcSLA` function (lines 25–30) with identical logic. The local version shadows the shared one and was presumably written without checking if a shared version existed. Since `business.ts`'s `calcSLA` is re-exported from `useDataverse.ts`, the ISM Workspace could import it directly.

**Expected Implementation:** Remove the local `calcSLA` definition from `ISMWorkspace.tsx`. Import `calcSLA` from `../../hooks/useDataverse` (which re-exports it from `business.ts`).

**Root Cause:** The ISM Workspace was likely developed in parallel with or before the `business.ts` version was created, or the developer was unaware of the shared utility.

**Business Impact:** If the SLA calculation formula changes (e.g., to include `UATUpdates` status as non-terminal), the `ISMWorkspace` will produce different results from the Dashboard and Reports modules because it uses its own copy. This creates data consistency issues in management reporting.

**Recommended Solution:** Remove lines 25–30 from `ISMWorkspace.tsx`. Add `import { calcSLA } from '../../hooks/useDataverse';`. Add a TypeScript ESLint rule or ADR mandating that utility functions must live in `src/utils/` and not be re-declared in component files.

---

### F-048: `NAVIGATE_COMMANDS` in Header Contains Incorrect Label for Security Route
| Field | Value |
|-------|-------|
| Module | `src/components/Header.tsx` line 71 |
| Category | Bug |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** Line 71 of `Header.tsx` in the `NAVIGATE_COMMANDS` array: `{ page: 'security', label: 'Admin Dashboard', shortcut: '' }`. The `security` route renders the `SecurityRoles` component (Security & Roles management), not the Admin Dashboard. The Admin Dashboard is at route `admin-dashboard`. This causes the command palette to show two "Admin Dashboard" entries and mislabel the Security & Roles page.

**Expected Implementation:** Change the label to `'Security & Roles'` to match the `WORKSPACE_NAMES` map in `App.tsx` line 143: `security: 'Security & Roles'`. Optionally add `{ page: 'admin-dashboard', label: 'Admin Dashboard', shortcut: '' }` to the commands list.

**Root Cause:** Copy-paste error when adding the security route to the command palette.

**Business Impact:** Users searching for "Security" in the command palette find an entry labelled "Admin Dashboard", creating confusion. A user looking for the actual Admin Dashboard searches for it and finds nothing useful.

**Recommended Solution:** Change line 71: `{ page: 'security', label: 'Security & Roles', shortcut: '' }`. Add `{ page: 'admin-dashboard', label: 'Admin Dashboard', shortcut: '' }` to the list.

---

### F-049: Comment Edit Window Hardcoded to 5 Minutes — Not Configurable
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` line 260 `const EDIT_WINDOW_MS = 5 * 60 * 1000` |
| Category | Feature Gap |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** Users can edit their own comments within a 5-minute window after posting. The threshold is a hardcoded constant. There is no Admin-configurable setting for this value, and once the window passes, the comment is permanently uneditable by the author (though Admins with Dataverse access could modify the raw JSON).

**Expected Implementation:** The edit window duration should be a configurable application setting (stored in `cgmp_applicationsettings` per F-042 recommendation) defaulting to 15 minutes. Alternatively, allow unlimited editing by the comment author but log each edit in the history audit.

**Root Cause:** The 5-minute window was chosen as a reasonable default. Configuration infrastructure for such values doesn't yet exist in the application.

**Business Impact:** Minor user experience friction — users who notice a typo 6 minutes after posting cannot fix it. The value of 5 minutes was arbitrary.

**Recommended Solution:** Move `EDIT_WINDOW_MS` to the application settings store once that is implemented (F-042 follow-on). Default to 15 minutes. Allow Admin to configure it between 0 (disabled) and 60 minutes.

---

### F-050: `appendHistory` Silently Trims History Without User Notification
| Field | Value |
|-------|-------|
| Module | `src/utils/business.ts` lines 52–65 |
| Category | Bug |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** `appendHistory` caps the history array at 500 entries and trims to 450 when the cap is reached, emitting only a `console.warn`. The oldest 50 audit entries are permanently deleted from `cgmp_versionhistory`. No notification is shown to the user, no audit log is created recording the truncation event, and no Admin is alerted.

**Expected Implementation:** History truncation should be treated as a data-loss event. When the 500-entry cap is reached: (1) Create a `cgmp_auditlogs` record noting "Version history truncated for change [ID] at [timestamp]". (2) Archive the trimmed entries to a `cgmp_changehistory` record (per F-009) before discarding. (3) Surface a warning to the Admin in the Admin Dashboard that long-running changes are accumulating excessive history. (4) As a systemic fix, migrating to a proper `cgmp_changehistory` table eliminates the cap entirely.

**Root Cause:** The cap was added as a safety guard when the blob approach was chosen. The `console.warn` was a developer marker that was never elevated to a production-visible alert.

**Business Impact:** Changes with very active comment threads, frequent reschedules, or long version histories (common for complex multi-week changes) will silently lose their oldest comments and history entries. This undermines the audit trail completeness.

**Recommended Solution:** Before trimming, write trimmed entries to `cgmp_changehistory` using `Cgmp_changehistoryService.create()` (fire-and-forget). Create a `cgmp_auditlogs` entry for the truncation event. Raise an Admin notification via `Cgmp_notificationsService`.

---

### F-051: Auto-Save in Edit Mode Does Not Snapshot `cgmp_versionhistory`
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 880–915 (auto-save timer) |
| Category | Bug |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** The 60-second auto-save in edit mode patches only the "safe" fields (title, description, location, etc.) but does not update `cgmp_versionhistory`. However, the manual `handleSave` re-fetches the latest `cgmp_versionhistory` from Dataverse before writing the new version, to merge concurrent changes. If auto-save writes an intermediate state between two concurrent users' manual saves, the version history re-fetch in `handleSave` will see the auto-saved state rather than the original state, potentially producing an incorrect diff.

**Expected Implementation:** The auto-save should explicitly exclude all fields that participate in the version history merge logic (`cgmp_status`, `cgmp_versionhistory`, `cgmp_reviewedby`). Document in code which fields are "safe" for auto-save and which require the full re-fetch-merge cycle.

**Root Cause:** The auto-save payload was assembled by listing "safe" fields without formally defining what "safe" means in terms of the concurrent-merge logic.

**Business Impact:** Rare but impactful: a user editing a change may see "Changes saved" auto-save confirmation and believe the change is saved, then navigate away — but the version history diff that `handleSave` would have appended is never written. The change record reflects the auto-saved data state without a corresponding history entry.

**Recommended Solution:** Add a comment block above the auto-save payload listing the invariants: "These fields do not participate in the version history merge. Status and versionhistory are excluded deliberately." Ensure `cgmp_versionhistory` is never included in the auto-save payload.

---

### F-052: ITOps Has No Access to Change Bridge Execution — Route Depends on GIICC
| Field | Value |
|-------|-------|
| Module | `src/utils/roles.ts` `ALLOWED_TRANSITIONS`, `src/components/itops/ITOpsWorkspace.tsx`, `src/components/giicc/GIICCCommandCenter.tsx` |
| Category | Feature Gap |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** Bridge execution is entirely within the GIICC Command Center workspace. The ITOps Workspace has no bridge-related functionality. The `ALLOWED_TRANSITIONS` table shows that `STATUS.Released → STATUS.InProgress` is allowed for both `ROLES.GIICC` and `ROLES.ITOps` (line 88–91 in `roles.ts`). However, the actual bridge creation and execution UI is behind the `giicc` route which the ITOps sidebar item does not include — ITOps role (100000002) is not in the `roles` array for the `giicc` nav item in `Sidebar.tsx` (line 55).

**Expected Implementation:** If ITOps can transition changes to InProgress (which the state machine allows), they should be able to view active bridges for those changes. Either: (1) Add a read-only bridge view to the ITOps Workspace showing bridges associated with changes in the ITOps queue. (2) Grant ITOps read access to the GIICC workspace (add 100000002 to the nav item's `roles` array). (3) Remove `ROLES.ITOps` from the `Released → InProgress` transition if only GIICC is supposed to own that action.

**Root Cause:** The transition table was defined with both roles but the UI only enables this action for GIICC. This is likely an intentional business rule that was not reflected in the transition table.

**Business Impact:** The `canTransition` utility returns `true` for ITOps attempting `Released → InProgress`, which could mislead a developer building an ITOps UI feature to believe ITOps can initiate changes. Meanwhile, no UI exposes this capability.

**Recommended Solution:** Clarify the business rule: can ITOps or only GIICC start bridge execution? Update `ALLOWED_TRANSITIONS` accordingly. If ITOps should not have this capability, remove `ROLES.ITOps` from the `Released → InProgress` entry.

---

### F-053: Reschedule Proposal Matching Uses UPN String with No GUID Fallback for ITOps Profiles
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 957, 991 |
| Category | Bug |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** When a reschedule proposal is accepted or declined, the proposer is found with: `const proposer = allProfiles.find(p => (proposal.byProfileId && p.cgmp_userprofileid === proposal.byProfileId) || p.cgmp_userprincipalname === proposal.by)`. The `proposal.by` field stores the `currentUserUpn` at time of proposal, and `proposal.byProfileId` stores the GUID. This dual-match is correct. However, the `allProfiles` list comes from `useAllUserProfiles()`, which limits to 500 records. If the proposing ITOps user is beyond the 500-record limit, the match fails silently and no notification is sent.

**Expected Implementation:** This is a consequence of the top-500 limit on `UserProfilesContext`. The correct fix is to implement pagination in `UserProfilesContext` (F-017). As a targeted fix, when `proposer` is null, explicitly fetch the profile by UPN: `Cgmp_userprofilesService.getAll({ filter: \`cgmp_userprincipalname eq '${escapeODataString(proposal.by)}'\`, top: 1 })`.

**Root Cause:** The 500-record cap on `UserProfilesContext` creates a population of users invisible to profile lookup. In large deployments this is a realistic scenario.

**Business Impact:** ITOps users who proposed a reschedule do not receive the accept/decline notification if their profile is beyond the 500-record cache limit. The PMO appears to ignore the proposal.

**Recommended Solution:** Add a fallback fetch-by-UPN when `proposer` is null: `const fetchedProfile = await Cgmp_userprofilesService.getAll({ filter: buildODataFilter('cgmp_userprincipalname', proposal.by), top: 1 })`. This is a small targeted fix that does not require the full pagination refactor.

---

### F-054: `isIsmFrozen` Warning Displayed But Does Not Block Editing
| Field | Value |
|-------|-------|
| Module | `src/utils/business.ts` `isIsmFrozen()`, `src/components/ism/ISMWorkspace.tsx`, `src/components/itops/ITOpsWorkspace.tsx` |
| Category | Feature Gap |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** The `isIsmFrozen` function returns `true` when the current time is past `startTime - 3 days` (ISM freeze date). The ITOps Workspace displays a freeze warning badge on changes near their freeze date. However, no component actually gates any write operation based on `isIsmFrozen`. An ISM user can still update UAT contacts, sign off, or add concerns to a change after the freeze date has passed.

**Expected Implementation:** When `isIsmFrozen(change.cgmp_starttime)` returns `true`: (1) ISM Workspace edit actions (UAT contact update, concern raising, sign-off) should be disabled with a tooltip explaining the freeze. (2) An override mechanism (Admin approval) should be available. (3) Any freeze-override action should be logged in `cgmp_auditlogs`.

**Root Cause:** The freeze logic was implemented as a display indicator without the corresponding write-gate enforcement.

**Business Impact:** The ISM freeze date is a key governance control — it prevents last-minute changes to UAT contacts and sign-off commitments close to the change window. Without enforcement, the control exists only on paper.

**Recommended Solution:** In ISM Workspace edit action handlers, add a guard: `if (isIsmFrozen(change.cgmp_starttime) && !isAdmin) { showToast('error', 'This change is frozen — the ISM freeze date has passed. Contact Admin for an override.'); return; }`. For Admin overrides, log the action with `cgmp_auditlogs`.

---

### F-055: Bridge Status Inconsistency Between Model and Application Constants
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_bridgesModel.ts` (`Cgmp_bridgescgmp_status`), `src/utils/roles.ts` `BRIDGE_STATUS` |
| Category | Bug |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** `Cgmp_bridgesModel.ts` defines status 100000000 as `'Active'`. However, `BRIDGE_STATUS` in `roles.ts` defines 100000000 as `InProgress`, and `BRIDGE_STATUS_LABEL_MAP` maps 100000000 to `'In Progress'`. The bridge filter in `useBridges` uses `'cgmp_status eq 100000000 or cgmp_status eq 100000004'` (matching the model's `Active` and `Scheduled` codes). The label displayed in the UI for code 100000000 is "In Progress" (from `BRIDGE_STATUS_LABEL_MAP`), which differs from the model's "Active" label.

**Expected Implementation:** Align the application constant name with the Dataverse option-set label. Since the model was generated from Dataverse, the correct name is "Active" (not "InProgress"). Update `BRIDGE_STATUS.InProgress` to `BRIDGE_STATUS.Active` and update `BRIDGE_STATUS_LABEL_MAP[100000000]` to `'Active'`. Update all references to `BRIDGE_STATUS.InProgress` throughout `GIICCCommandCenter`, `ITOpsWorkspace`, `RightPanel`, and `useBridges`.

**Root Cause:** The Dataverse option-set label "Active" was renamed to "InProgress" in the application constants to better reflect the bridge's operational state. This divergence creates confusion when reading model code alongside application code.

**Business Impact:** Developers reading `BRIDGE_STATUS.InProgress` and then looking at `Cgmp_bridgescgmp_status` see `'Active'` for the same code. New developers may introduce bugs by comparing against the wrong constant.

**Recommended Solution:** Either (1) Update Dataverse option-set label from "Active" to "In Progress" (requires solution change) or (2) Keep the application constant as `BRIDGE_STATUS.Active` to match the model. Option 2 is lower risk. Update the code and add an inline comment: `// Dataverse calls this 'Active'; displayed as 'In Progress' in BRIDGE_STATUS_LABEL_MAP`.

---

### F-056: No Input Sanitisation on Free-Text Fields Before Dataverse Write
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` `handleSave()` base payload; all textarea inputs |
| Category | Security |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** Free-text fields (`cgmp_title`, `cgmp_description`, `cgmp_timeline`, `cgmp_pirnotes`) are trimmed with `.trim()` before being written to Dataverse but receive no further sanitisation. If any component in the application renders these fields via `dangerouslySetInnerHTML` (none currently observed, but a future risk), raw HTML could be injected. Additionally, very long strings are not validated against Dataverse column size limits before the API call, relying on the Dataverse layer to enforce them.

**Expected Implementation:** (1) Add maximum-length validation in `validate()` for all text fields — Dataverse `nvarchar(max)` fields have a practical UI limit that should be reflected in client-side validation. (2) Add a shared `sanitiseText(s: string): string` utility that strips leading/trailing whitespace and collapses multiple consecutive spaces. (3) Ensure no field value is ever passed to `dangerouslySetInnerHTML` — add an ESLint rule (`no-danger`) to the project.

**Root Cause:** No explicit content sanitisation policy was defined at the start of development.

**Business Impact:** Overly long strings (e.g., a 50,000-character paste into the description field) will fail at the Dataverse API layer with a cryptic error. No field-length validation is shown to the user before submission.

**Recommended Solution:** Add length constraints to `validate()`: `if (form.description.length > 10000) e.description = 'Description too long (max 10,000 characters)';`. Add `no-danger: error` to ESLint configuration. Document the maximum field lengths for each Dataverse text column.

---

### F-057: `useDebounce` Hook Exported but Internal Implementation Not Confirmed Present
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` line 31 (`export { useDebounce } from './useDebounce'`), `src/hooks/useDebounce.ts` (not read but referenced) |
| Category | Technical Debt |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** `useDataverse.ts` re-exports `useDebounce` from `'./useDebounce'`. The `useDebounce` hook is used in the `ITOpsWorkspace` component for the search input debounce (the component implements its own `useEffect`-based debounce at line 148 rather than using the shared hook). The shared hook is not used in `ChangeForm`, `Header`, or any other high-frequency search input.

**Expected Implementation:** All search/filter debounce patterns should use the shared `useDebounce` hook. The inline `useEffect` + `setTimeout` pattern in `ITOpsWorkspace` (lines 148–151) should be replaced with `const debouncedSearch = useDebounce(search, 300)`.

**Root Cause:** The shared hook exists but was not consistently adopted across the codebase.

**Business Impact:** Minor inconsistency. Different debounce timeouts across components (300ms, potentially others) could produce inconsistent UX.

**Recommended Solution:** Replace all inline `setTimeout`-based debounce patterns with `useDebounce`. Audit `Header.tsx`, `ITOpsWorkspace.tsx`, `ISMWorkspace.tsx`, and `GIICCCommandCenter.tsx` for inline debounce implementations.

---

### F-058: Notifications Created with `as any` on Critical Structural Fields
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 857–866, 959–969, 993–1003; `src/components/itops/ITOpsWorkspace.tsx` (multiple notification create calls) |
| Category | Technical Debt |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** All `Cgmp_notificationsService.create()` calls throughout the codebase use `as any` for the `cgmp_category`, `cgmp_priority`, and `statecode` fields: `cgmp_category: 100000000 as any, cgmp_priority: 100000000 as any, statecode: 0 as any`. The notification model requires these fields to be their respective enum types, but numeric literals require a cast.

**Expected Implementation:** Add type-safe factory functions per F-046 recommendation. For notifications specifically: `import { NOTIFICATION_CATEGORY, NOTIFICATION_PRIORITY } from '@utils/roles'; ... cgmp_category: NOTIFICATION_CATEGORY.ReviewRequest as Cgmp_notificationscgmp_category`. Alternatively, create a `createNotification(payload: NotificationPayload): Promise<void>` helper that encapsulates the type casts in one place.

**Root Cause:** Consistent with F-027 — the generated model types and application number constants don't align without explicit casting.

**Business Impact:** The `as any` cast at notification creation means that passing an invalid category code (e.g., `99999999`) would compile without error but fail at runtime with a Dataverse validation error that presents as an unhandled exception.

**Recommended Solution:** Create `src/utils/notificationFactory.ts` with: `export async function createNotification(payload: {...strongly typed...}): Promise<void> { ... }`. All notification creation calls replace their inline `Cgmp_notificationsService.create({ ... as any })` with `createNotification({ ... })`.

---

### F-059: `ChangeForm` Uses `(c as any).cgmp_changepoc` and Similar Unnecessary Casts
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 77, 87, 1122 |
| Category | Technical Debt |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** The `fromChange()` function accesses `(c as any).cgmp_changepoc` (line 77) and `(c as any).cgmp_uatrequired` (line 87), casting to `any` to access these fields. However, both `cgmp_changepoc` and `cgmp_uatrequired` are declared in `Cgmp_changesBase` (as `cgmp_changepoc?: string` and `cgmp_uatrequired?: boolean`) and should be accessible without a cast.

**Expected Implementation:** Remove the `as any` casts. Access `c.cgmp_changepoc` and `c.cgmp_uatrequired` directly. These fields are present in the model interface.

**Root Cause:** The casts may have been added before these fields were added to the generated model, or as a quick fix when TypeScript complained for a different reason that was subsequently resolved.

**Business Impact:** Low direct impact. The casts mask any future type errors on these specific fields if the model changes.

**Recommended Solution:** Remove lines 77 and 87 casts: `changepoc: c.cgmp_changepoc ?? ''`, `uatrequired: c.cgmp_uatrequired ?? false`. Run `tsc --noEmit` to confirm no type errors are introduced.

---

### F-060: Observer Role Read-Only Enforcement Incomplete at Form Level
| Field | Value |
|-------|-------|
| Module | `src/context/AppContext.tsx` line 233 (`canEdit = roleCode !== EXTENDED_ROLES.Observer`), `src/components/pmo/ChangeForm.tsx`, `src/components/itops/ITOpsWorkspace.tsx` |
| Category | Security |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** `AppContext` computes `canEdit = roleCode !== EXTENDED_ROLES.Observer`. The `Sidebar` shows all navigation items to Observers. However, the enforcement of `canEdit = false` is incomplete: the PMO Workspace's "Create Change" and "Edit" buttons check `canEdit` but the direct `ChangeForm` API call path (`ChangeForm.handleSave`) does not independently verify the role before calling `Cgmp_changesService.create/update`. If an Observer navigates to the form through a deep link or an unexpected code path, they can save changes.

**Expected Implementation:** Add a guard at the beginning of every write operation: `if (!canEdit) { showToast('error', 'Read-only access — you cannot modify records.'); return; }`. This guard should be present in `ChangeForm.handleSave`, `ITOpsWorkspace.handleReview`, `ISMWorkspace.handleSignOff`, and all other write-path handlers. This is a defence-in-depth measure supplementing (not replacing) the Dataverse permission layer.

**Root Cause:** The `canEdit` flag is checked at the UI-presentation level (hiding buttons) but not at the mutation-handler level (blocking API calls).

**Business Impact:** The Observer role is intended for stakeholders who should have zero write access. Without handler-level enforcement, an Observer who discovers a UI path to the form can save changes despite the role intent.

**Recommended Solution:** At the start of every async write handler in workspace components, add: `if (!canEdit) { showToast('error', CGMP_ERRORS.E031.message); return; }`. This is a 1-line change per handler and provides an additional safety net.

---

### F-061: No Offline or Connectivity Error Handling — All Fetch Failures Are Silent
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` (all hooks), `src/App.tsx` |
| Category | Feature Gap |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** All `useDataverse` hooks catch errors and call `setError()` at the hook level, but there is no global network-status monitor. If the user's machine goes offline or the Dataverse OData endpoint becomes temporarily unreachable (network switch, VPN drop, Teams reconnect), every 30-second poll and every user action fails with an unhandled Promise rejection surfaced only in the browser console. No toast, no banner, no retry logic is shown to the user.

**Expected Implementation:** Add a `useNetworkStatus` hook that listens to `window.addEventListener('offline'/'online')` and exposes `isOnline: boolean`. When `isOnline` becomes false: (1) Show a persistent red banner: "You are offline — changes cannot be saved until connectivity is restored." (2) Pause all polling intervals (notification, profile refresh, auto-save). When `isOnline` becomes true again, resume polling and trigger an immediate data refresh. Additionally, implement exponential-backoff retry (3 attempts: 2s/4s/8s) in the core data hooks before surfacing an error state.

**Root Cause:** Network resilience was not included in the initial development scope.

**Business Impact:** Change engineers working over VPN in geographically distributed offices regularly experience momentary VPN reconnects. A silent failure during critical change execution could lead a user to believe a status update was saved when it was not, with no indication that anything went wrong.

**Recommended Solution:** Create `src/hooks/useNetworkStatus.ts` returning `{ isOnline, wasOffline }`. Add an `<OfflineBanner>` component to `App.tsx` rendered above the workspace router when `!isOnline`. Implement a `withRetry(fn, maxAttempts = 3)` wrapper in `src/utils/apiHelpers.ts` used by all hook fetch calls.

---

### F-062: OData Filter String Escaping Is Inconsistently Applied
| Field | Value |
|-------|-------|
| Module | `src/utils/business.ts` `buildODataFilter()`, `src/hooks/useDataverse.ts` lines 44, 55, 75, `src/components/ism/ISMWorkspace.tsx` line 143 |
| Category | Security |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** A `buildODataFilter()` utility exists in `business.ts` that properly escapes single quotes in OData string values by doubling them (`value.replace(/'/g, "''")`) before embedding them in filter expressions. However, multiple filter strings throughout `useDataverse.ts` and workspace components are built using template literals without escaping: `` `cgmp_userprincipalname eq '${upn}'` `` (line 55), `` `cgmp_title eq '${searchTerm}'` `` (ISMWorkspace line 143). A UPN or search term containing a single quote (e.g., `O'Brien@company.com`) produces an invalid OData filter that either errors or causes unintended filtering.

**Expected Implementation:** All OData filter strings containing user-supplied or variable values must use `buildODataFilter()` or an equivalent `escapeODataString()` helper. Add a custom ESLint rule (or `@typescript-eslint/no-template-curly-in-string` equivalent) that flags template-literal OData filter construction without escaping.

**Root Cause:** The `buildODataFilter()` utility was created after several filter strings were already written. Not all existing filter strings were updated to use it.

**Business Impact:** A crafted search string containing a single quote can produce a 400 Bad Request from Dataverse that surfaces as an app crash to the user. Free-text search fields in the ISM Workspace are a realistic injection surface for any authenticated user.

**Recommended Solution:** Export `escapeODataString(val: string): string` from `src/utils/business.ts`. Audit all template-literal filter strings in `useDataverse.ts` and all workspace components. Replace raw template literals: `` `cgmp_userprincipalname eq '${escapeODataString(upn)}'` ``.

---

### F-063: `pac modelbuilder` Regen Script Silently Overwrites `checkForAuthError` Patches
| Field | Value |
|-------|-------|
| Module | `package.json` `regen` script, `src/generated/services/Cgmp_changesService.ts`, `src/generated/services/Cgmp_bridgesService.ts` |
| Category | Architecture |
| Priority | High |
| Complexity | High |

**Current Implementation:** The `regen` npm script runs `pac modelbuilder build` which regenerates all files in `src/generated/`. `Cgmp_changesService.ts` contains hand-written additions: `checkForAuthError()`, `dispatchSessionExpiry()`, and the `authChecked` wrapper calls within `create()`, `update()`, `get()`, and `getAll()`. These are not in the model-generated baseline. Every time `regen` is run, these hand-written additions are silently erased.

**Expected Implementation:** Apply one of two patterns: (1) **Wrapper pattern** — Create `src/services/ChangesService.ts` that imports from `@generated/services/Cgmp_changesService` and adds auth-error detection in a wrapper class. The generated file is never hand-edited. (2) **Post-generate patch script** — After `pac modelbuilder build`, run a Node.js script (`scripts/patch-generated.mjs`) that applies auth-error patches using AST transforms (`ts-morph`). The `regen` script becomes `pac modelbuilder build && node scripts/patch-generated.mjs`.

**Root Cause:** There is no documented policy for how hand-written additions to generated files are preserved across regen cycles — a common problem with code-generation toolchains.

**Business Impact:** A developer running `npm run regen` to pull in a new Dataverse column will unwittingly remove session-expiry detection from the changes service. The next deployment will have a regression where 401 errors are no longer caught and users see raw error dialogs instead of the session-expired banner.

**Recommended Solution:** Implement the wrapper pattern. Create `src/services/` directory. Move `checkForAuthError` and `dispatchSessionExpiry` to `src/services/authGuard.ts`. Create `src/services/ChangesService.ts` wrapping the generated service. Mark `src/generated/` as "do not edit manually" in a header comment on each file.

---

### F-064: `cgmp_userfavorites` Stored as a Comma-Delimited String — No Referential Integrity
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_userprofilesModel.ts` (`cgmp_userfavorites?: string`), `src/hooks/useDataverse.ts` `toggleFavorite()` |
| Category | Architecture |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** User-favorited changes are stored as a comma-separated string of change GUIDs in `cgmp_userfavorites` on `cgmp_userprofiles`. `toggleFavorite(changeId)` parses the string, adds or removes the GUID, and patches the user's profile record. There is no referential integrity — if a change is deleted, its GUID remains in the favorites string indefinitely.

**Expected Implementation:** Create a `cgmp_userfavorites` intersection table with columns `cgmp_userprofileid` (lookup to `cgmp_userprofiles`) and `cgmp_changeid` (lookup to `cgmp_changes`). This is a standard N:M Dataverse relationship. Referential integrity is enforced by Dataverse: deleting a change cascades to remove its favorite records.

**Root Cause:** The favorites list was implemented as a quick string field to avoid schema changes. As the feature grew it was not promoted to a proper Dataverse relationship.

**Business Impact:** At scale (500+ users, 1000+ changes), a string of 200 GUIDs per user profile is 7,200 characters per profile record. Stale GUIDs from deleted changes accumulate without cleanup. Querying "all users who favorited change X" requires loading all user profiles and parsing each string — a multi-second client-side scan.

**Recommended Solution:** Define the `cgmp_userfavorites` relationship in the Dataverse solution. Generate the service class via `pac modelbuilder`. Migrate existing data by parsing the string field and creating intersection records. Remove the `cgmp_userfavorites` string column from `cgmp_userprofiles`.

---

### F-065: `useAllBridges` and `useNotifications` Poll Independently — No Coordination
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` `useAllBridges()` (`autoRefreshMs` param), `useNotifications()` (`NOTIF_POLL_MS = 30_000`) |
| Category | Performance |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** `useAllBridges` runs its own `setInterval` at `autoRefreshMs` (default 60,000ms) when `autoRefreshMs > 0`. `useNotifications` runs its own `setInterval` at 30,000ms. Both poll independently with no coordination. When a user is on the GIICC Command Center (which uses both hooks), two independent polling timers fire on overlapping schedules, creating two concurrent Dataverse API requests every 30 seconds. If multiple workspace components mount independently, multiple hook instances accumulate separate intervals.

**Expected Implementation:** Centralise all polling in top-level context providers. Move notification polling to `AppContext` or a dedicated `NotificationsContext`. Move bridge refresh to a `BridgesContext` with a single global interval. Workspace components subscribe to context data rather than mounting their own polling hooks. This consolidates 3–5 independent intervals into at most two coordinated ones.

**Root Cause:** Each hook was built independently with its own refresh logic. There is no polling coordination layer.

**Business Impact:** In the GIICC Command Center, 2–3 polling intervals fire simultaneously, potentially triggering Dataverse API rate limiting (429 responses) for users who keep the app open all day. Multiple open Teams tabs each run all polls independently.

**Recommended Solution:** Create a `PollingManager` singleton in `src/utils/pollingManager.ts` that deduplicates polling by endpoint key. Hooks register a poll key and callback; the manager runs a single interval per key regardless of how many hook instances request it.

---

### F-066: `ISMDeputy` (100000006) Absent from `ALLOWED_TRANSITIONS` — Governance Gap
| Field | Value |
|-------|-------|
| Module | `src/utils/roles.ts` lines 44–78 (`ALLOWED_TRANSITIONS`), `src/components/ism/ISMWorkspace.tsx` |
| Category | Feature Gap |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** `ALLOWED_TRANSITIONS` is keyed by `RoleCode` and defined only for `ROLES.Admin`, `ROLES.PMO`, `ROLES.ITOps`, `ROLES.ISM`, and `ROLES.GIICC`. `EXTENDED_ROLES.ISMDeputy` (100000006) has no entry. The `canTransition(fromStatus, toStatus, roleCode)` function falls through to `return false` for ISMDeputy. However, `hasISMPermissions()` returns `true` for ISMDeputy (line 88 of `roles.ts`), confirming that ISMDeputy should have ISM-equivalent access. Any code path that calls `canTransition()` directly for an ISMDeputy user always returns false.

**Expected Implementation:** Add `[EXTENDED_ROLES.ISMDeputy]: { ...ALLOWED_TRANSITIONS[ROLES.ISM] }` to `ALLOWED_TRANSITIONS`. If ISMDeputy intentionally has a subset of ISM transitions (e.g., cannot close a change), define the subset explicitly with an explanatory comment.

**Root Cause:** When ISMDeputy was added to `EXTENDED_ROLES`, its `ALLOWED_TRANSITIONS` entry was omitted. The `hasISMPermissions()` helper was updated but the transition table was not.

**Business Impact:** ISMDeputy users who attempt status transitions that should be permitted see "transition not allowed" errors. During ISM absence, the ISMDeputy cannot advance changes through the lifecycle, blocking the change programme.

**Recommended Solution:** Add the ISMDeputy entry to `ALLOWED_TRANSITIONS`. Add a unit test: `assert canTransition(STATUS.UnderReview, STATUS.Released, EXTENDED_ROLES.ISMDeputy) === true`. This is a one-line fix with high governance impact.

---

### F-067: `PIRForm` Accepts Unbounded `downtimeMinutes` — No Maximum Validation
| Field | Value |
|-------|-------|
| Module | `src/components/giicc/PIRForm.tsx` lines 188–194 (downtimeMinutes input) |
| Category | Bug |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** The PIR form's `downtimeMinutes` field is rendered as `<input type="number" min="0">` with no `max` attribute and no server-side validation before write. A user can enter `9999999`. The `calcSLA` function does not use `downtimeMinutes`, but dashboard reports that aggregate total downtime minutes will produce nonsensical figures if even one record carries an extreme value.

**Expected Implementation:** Add `max="10080"` (7 days × 24 × 60 — a reasonable maximum for any planned change window). Add validation in `handleSave`: `if (form.downtimeMinutes < 0 || form.downtimeMinutes > 10080) { setErrors(e => ({ ...e, downtimeMinutes: 'Must be 0–10,080 minutes (0–7 days)' })); return; }`.

**Root Cause:** The numeric input was added without upper-bound validation.

**Business Impact:** A PIR submitted with 9,999,999 downtime minutes makes the aggregate MTTR statistic in the Reports workspace meaningless and could trigger integer overflow in any Power BI DAX measure summing the column.

**Recommended Solution:** Add `max={10080}` to the `<input>` element. Add validation to `handleSave`. Consider a duration picker UI (days + hours + minutes) for better user experience.

---

### F-068: Blackout Period Check Triggered Only on Submit — Not on Date Picker Change
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` line 741 in `handleSave()` |
| Category | Bug |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** The blackout-period validation runs inside `handleSave()`. When a PMO user selects a date/time in the date picker, no blackout warning is shown until they click Save. At that point, a `window.confirm` dialog asks if they want to proceed. This is too late in the user journey — the PMO may have completed all 30+ other fields before discovering at the final step that the date is blocked.

**Expected Implementation:** Run the blackout check in an `onChange` handler for the `cgmp_starttime` and `cgmp_endtime` date pickers. Display an inline warning immediately after date selection: "Warning: Selected window overlaps with blackout period [name] from [start] to [end]." The save should still be possible with an explicit acknowledgement checkbox, not a `window.confirm` dialog.

**Root Cause:** The blackout check was implemented as part of the existing validation block in `handleSave`. Moving it to `onChange` was not done.

**Business Impact:** PMO engineers fill in a complex change form only to discover at submission that their date is blocked. This wastes time and creates friction in the change scheduling process.

**Recommended Solution:** Extract `isInBlackout(startTime, endTime, bridges)` into a pure function. Call it in the `startTime`/`endTime` `onChange` handlers. Show an inline `<Banner variant="warning">` when it returns true. Replace the `window.confirm` in `handleSave` with a pre-checked acknowledgement checkbox that appears alongside the banner.

---

### F-069: No Deep-Link URL Routing — Browser Refresh Loses Workspace Context
| Field | Value |
|-------|-------|
| Module | `src/App.tsx` (routing via React state, not URL path), `src/hooks/useNavigation.ts` |
| Category | Feature Gap |
| Priority | High |
| Complexity | High |

**Current Implementation:** The application uses a custom `useNavigation` hook backed by React state (not `react-router-dom` or the browser History API). The current workspace is stored in component state and `sessionStorage`. Browser refresh restores the last workspace page via `sessionStorage`, but there is no URL-based routing. Sharing a link to a specific change (e.g., "look at change CGM-2024-0145") requires the recipient to navigate to the PMO Workspace and search manually. The address bar always shows the base app URL.

**Expected Implementation:** Implement React Router v7 with URL-based routing. Each workspace maps to a path: `/pmo`, `/ism`, `/giicc`, etc. Individual change detail is at `/pmo/changes/:changeId`. For Teams compatibility, use hash routing (`<HashRouter>`) since Teams tabs may not support clean paths. Bookmarking and sharing specific change records becomes possible.

**Root Cause:** The application was built as a SPA without URL-based routing, relying on the sessionStorage workaround.

**Business Impact:** In an enterprise setting, users frequently share change records in Teams chats ("check CGM-2024-0145"). Without deep links, this requires verbal navigation instructions. Change Managers cannot link directly to a specific change in email communications.

**Recommended Solution:** Introduce `react-router-dom` v7. Map existing `ROUTES` constants to URL paths. Implement `<HashRouter>` wrapping the current routing state. Migrate navigation from `setCurrentPage(state)` to `useNavigate()`. For Teams, use the `subEntityId` field in the Teams entity context to encode the target change ID.

---

### F-070: Missing `aria-required` on Required Form Inputs in `ChangeForm`
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 495–780 (form inputs section) |
| Category | UI/UX |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** Required fields in `ChangeForm` are marked visually with a `*` suffix on their labels (CSS class `required`). However, none of the required `<input>`, `<textarea>`, or `<select>` elements carry the `aria-required="true"` attribute or the native `required` attribute. Screen readers using NVDA, JAWS, or Windows Narrator do not announce these fields as required.

**Expected Implementation:** Add `aria-required="true"` to all required form inputs. For custom components (e.g., the date picker, the multi-select dropdown), ensure the underlying `<input>` or role-compliant element carries `aria-required`. Associate each error message with its input via `aria-describedby`.

**Root Cause:** Accessibility attributes were not systematically applied during component development.

**Business Impact:** Employees with visual impairments using screen readers cannot determine which fields are required before attempting to submit. This fails WCAG 2.1 Success Criterion 1.3.1 (Info and Relationships) and may create compliance exposure under enterprise accessibility policies.

**Recommended Solution:** Create a shared `<FormField required label="..." error="..." id="...">` wrapper component that automatically applies `aria-required`, `aria-describedby`, and associates the `<label>` `htmlFor` with the input `id`. Replace all bare `<label>` + `<input>` pairs in `ChangeForm` with this wrapper.

---

### F-071: Microsoft Teams Theme Not Synchronised via `microsoftTeams.app.getContext()`
| Field | Value |
|-------|-------|
| Module | `src/context/AppContext.tsx` (Teams SDK initialisation), `src/index.css` (CSS variables for light/dark theme) |
| Category | UI/UX |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** The application has CSS custom properties for light and dark themes toggled by a `data-theme` attribute on `<html>`. However, the Teams theme (light, dark, high-contrast) returned by `microsoftTeams.app.getContext()` is not read and applied. The app defaults to light theme regardless of the user's Teams colour setting. `microsoftTeams.app.registerOnThemeChangeHandler()` is also not registered, so live theme changes within Teams are not reflected.

**Expected Implementation:** After `microsoftTeams.app.initialize()`, call `microsoftTeams.app.getContext()` and read `context.app.theme`. Map `'dark'` → `data-theme="dark"`, `'contrast'` → `data-theme="high-contrast"`, `'default'` → `data-theme="light"`. Register `microsoftTeams.app.registerOnThemeChangeHandler(theme => applyTeamsTheme(theme))` for runtime theme changes.

**Root Cause:** Teams SDK theme integration was not implemented during initial Teams tab configuration.

**Business Impact:** Users who work in Teams dark mode see the app in bright white light mode, creating jarring contrast and reducing usability in low-light environments. High-contrast mode users lose accessibility adaptations.

**Recommended Solution:** Add a `useTeamsTheme()` hook to `src/hooks/useTeamsTheme.ts`. Call it in `AppContext` initialisation. Apply the result to `document.documentElement.setAttribute('data-theme', theme)`. This is a low-complexity, high-UX-impact change.

---

### F-072: Modal Dialogs Lack Focus Trap — Keyboard Focus Escapes Behind the Overlay
| Field | Value |
|-------|-------|
| Module | `src/components/ui/Modal.tsx`, `src/components/pmo/ChangeForm.tsx` (confirm dialogs), `src/components/giicc/BridgeModal.tsx` |
| Category | UI/UX |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** `Modal.tsx` renders a dialog overlay but does not implement a focus trap. When a modal opens, focus is not moved to the modal container, and pressing Tab allows focus to escape behind the overlay to the underlying page content. The `Escape` key to close modals is also not uniformly handled across all modal instances.

**Expected Implementation:** Use `aria-modal="true"` on the modal container. On open: (1) Move focus to the first focusable element within the modal. (2) Trap Tab/Shift+Tab cycles within the modal's focusable elements. (3) Register an `Escape` key handler to close the modal. On close: restore focus to the trigger element.

**Root Cause:** The Modal component was custom-built without implementing the WAI-ARIA dialog pattern focus management requirements.

**Business Impact:** WCAG 2.1 SC 2.1.2 (No Keyboard Trap) and SC 4.1.2 (Name, Role, Value) violations. In enterprise deployments where accessibility is audited, this creates remediation requirements and potential legal exposure.

**Recommended Solution:** Replace the custom `Modal.tsx` with `@radix-ui/react-dialog`, which provides focus trap, Escape handling, aria attributes, and scroll lock out of the box. Alternatively, add `react-focus-lock` as a wrapper inside the existing Modal component.

---

### F-073: `beforeunload` Audit Log Write Is Unreliable in Teams Iframe Context
| Field | Value |
|-------|-------|
| Module | `src/context/AppContext.tsx` lines 290–305 (`logout()` via `beforeunload`) |
| Category | Bug |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** The logout audit log (`cgmp_auditlogs` record for "User session ended") is written in a `beforeunload` event listener using a standard `fetch()` call. Chrome 92+ limits the time granted to `beforeunload` handlers, and Teams' iframe hosting context drops `beforeunload` events entirely in some scenarios. This means the session-end audit record is frequently never written.

**Expected Implementation:** Use `navigator.sendBeacon()` for the logout audit write. `sendBeacon` is specifically designed for reliable data sending on page unload — it is not blocked by the page lifecycle and does not require a response. Additionally, treat the profile-refresh heartbeat (every 30 minutes) as an implicit "last seen" timestamp — the session end is inferred when the heartbeat stops, making the explicit logout event a nice-to-have rather than a requirement.

**Root Cause:** Standard `fetch()` in `beforeunload` has been the historical approach but is unreliable in modern browsers and Teams iframe hosting.

**Business Impact:** Compliance reports showing "active sessions" may include ghost sessions where users closed the app without a recorded logout event, undermining audit trail completeness.

**Recommended Solution:** Replace the `fetch()` in the `beforeunload` handler with `navigator.sendBeacon(dataverseEndpoint, new Blob([JSON.stringify(auditPayload)], { type: 'application/json' }))`. Update `cgmp_lastseenat` on every profile-refresh tick to serve as a session heartbeat, enabling offline inference of session end.

---

### F-074: Draft Restore from `localStorage` Has No Expiry — Stale Drafts Persist Indefinitely
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` lines 190–210 (draft restore logic) |
| Category | Bug |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** When a PMO user creates a new change, `ChangeForm` saves form state to `localStorage` keyed by UPN every 30 seconds. On the next visit to the create form, the saved draft is offered for restoration. The saved draft has no expiry timestamp. A draft from six months ago would be offered for restoration as if it were current.

**Expected Implementation:** Add a `savedAt: Date.toISOString()` field to the localStorage draft object. On load, discard silently if `savedAt` is older than 7 days. If 1–7 days old, show the draft age in the restoration prompt: "Restore draft from 3 days ago?"

**Root Cause:** The expiry logic was not implemented when the draft restore feature was added.

**Business Impact:** A PMO engineer who began drafting a change during a planning exercise and never submitted it will be offered a stale, irrelevant draft every time they open the create form. Restoring an outdated draft without noticing could result in submitting a change with obsolete details.

**Recommended Solution:** Add `savedAt: new Date().toISOString()` when saving the draft. Add a check on restore: `if (Date.now() - new Date(draft.savedAt).getTime() > 7 * 24 * 60 * 60 * 1000) { localStorage.removeItem(draftKey); return; }`. Display draft age in the restoration UI.

---

### F-075: Teams Manifest Hardcodes Production IDs — Multi-Environment Deployment Impossible
| Field | Value |
|-------|-------|
| Module | `teams/manifest.json` (environmentId, tenantId, appId fields) |
| Category | Architecture |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** `teams/manifest.json` contains hardcoded production identifiers: `"environmentId": "5b9db983-0709-e578-ba8e-29a88812c217"`, `"tenantId": "e0793d39-0939-496d-b129-198edd916feb"`. The `_envConfig` comment in the file acknowledges this is a known issue. Deploying to a development or staging environment requires manually editing the manifest before packaging — it is error-prone and not automated.

**Expected Implementation:** Treat the manifest as a template with placeholder values. Create `teams/manifest.template.json` with `%%ENVIRONMENT_ID%%` and `%%TENANT_ID%%` placeholders. Add a build script (`scripts/build-manifest.mjs`) that reads environment variables and substitutes them, producing `teams/manifest.json` in `dist/`. Update the `deploy:app` script to run this step as part of the build pipeline.

**Root Cause:** The manifest was initially configured for production only. A templating approach was not implemented.

**Business Impact:** The development and staging environments cannot run as proper Teams tabs without manual manifest edits. This blocks a proper three-environment (dev/staging/prod) deployment pipeline and means developers cannot test Teams-specific behaviour in isolation from production.

**Recommended Solution:** Implement the manifest template approach. Add CI/CD environment variables for each environment. This is a prerequisite for establishing a proper deployment pipeline and should be resolved before the next environment is provisioned.

---

### F-076: Teams Manifest Missing ISM Workspace Tab
| Field | Value |
|-------|-------|
| Module | `teams/manifest.json` (`staticTabs` array) |
| Category | Feature Gap |
| Priority | High |
| Complexity | Low |

**Current Implementation:** The Teams manifest `staticTabs` array contains four tabs: Dashboard, PMO Workspace, GIICC Center, and IT Ops. The ISM Workspace is a full, role-critical workspace with UAT sign-off, freeze management, and concern tracking — but it has no dedicated Teams tab. ISM Managers (100000003) and ISMDeputy users (100000006) must navigate to the ISM Workspace from within the app after landing on another tab.

**Expected Implementation:** Add a fifth `staticTab` entry for the ISM Workspace with `contentUrl` pointing to the app root with a `?tab=ism` query parameter (or with deep-link routing once F-069 is implemented). The tab should be titled "ISM Workspace" with an appropriate icon.

**Root Cause:** The ISM Workspace tab was not added to the manifest when the ISM workspace was implemented. The four existing tabs were carried forward without reviewing completeness.

**Business Impact:** ISM Managers cannot pin a direct link to the ISM Workspace in their Teams navigation. Every session requires extra navigation steps. For a governance workflow driven by ISM sign-offs — a time-sensitive activity — this is significant daily friction for a core user group.

**Recommended Solution:** Add the ISM Workspace `staticTab` entry to `teams/manifest.json`. Pair with F-069 (deep-link routing) so that the Teams tab URL navigates directly to the ISM workspace on load.

---

### F-077: Power BI Iframe URL Lacks CSP Allowlisting and Origin Validation
| Field | Value |
|-------|-------|
| Module | `src/components/reporting/ReportingWorkspace.tsx` (Power BI embed), `index.html` (CSP meta tag) |
| Category | Security |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** The reporting workspace embeds a Power BI report iframe using a URL from an environment variable or configured setting. The `index.html` CSP does not include `frame-src https://app.powerbi.com` in its directives. The iframe `src` attribute is set directly from the configuration value without validating that the URL is a legitimate Power BI domain.

**Expected Implementation:** Add `frame-src 'self' https://app.powerbi.com` to the CSP meta tag in `index.html`. Add URL validation before setting the iframe `src`: `if (!/^https:\/\/app\.powerbi\.com\//.test(powerBiUrl)) { console.error('[CGMP] Invalid Power BI URL — iframe blocked'); return; }`. This prevents an Admin misconfiguration or injection from embedding a non-Power BI URL.

**Root Cause:** CSP `frame-src` was not defined for the Power BI embed, and the URL was implicitly trusted as an environment variable.

**Business Impact:** Without `frame-src` restriction, the browser permits embedding of arbitrary cross-origin content if the source URL is changed. An Admin user could accidentally configure a test URL that embeds an external page.

**Recommended Solution:** Update `index.html` meta CSP: `frame-src 'self' https://app.powerbi.com`. Add `validatePowerBIUrl(url: string): boolean` to `src/utils/business.ts`. Apply validation before rendering the `<iframe>`. Consider using the `powerbi-client-react` library for a more integrated embedding approach.

---

### F-078: Bridge Creation Allows No Change Association — Orphaned Bridges Accumulate
| Field | Value |
|-------|-------|
| Module | `src/components/giicc/BridgeModal.tsx`, `src/generated/models/Cgmp_bridgesModel.ts` (`cgmp_changeid?: string`) |
| Category | Architecture |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** `cgmp_changeid` is an optional field on `cgmp_bridges`. The `BridgeModal` form allows creating a bridge without associating it with a change record. When `cgmp_changeid` is null, the bridge appears in `useAllBridges()` results but cannot be correlated to any change in the Dashboard, ISM Workspace, or Reports workspace.

**Expected Implementation:** A bridge should always be associated with exactly one change record. Make `cgmp_changeid` required in the bridge creation form with a change-lookup search field. Update the Dataverse schema to make `cgmp_changeid` `RequiredLevel: ApplicationRequired`. If global maintenance bridges unassociated with a specific change are a legitimate use case, add a boolean `cgmp_issystembridge` field rather than leaving `cgmp_changeid` nullable.

**Root Cause:** The optional field was carried over from the initial model design when the bridge concept was less defined.

**Business Impact:** Orphaned bridges with no change association appear in bridge counts and reports, creating confusion. An GIICC user creating a bridge from the Command Center may forget to associate it and the bridge becomes invisible to change tracking.

**Recommended Solution:** Add required validation to `BridgeModal` for the change-association field. Update the Dataverse `cgmp_changeid` column to `RequiredLevel: ApplicationRequired`. If system bridges are needed, add `cgmp_issystembridge: boolean` and filter orphaned bridges out of change-specific views.

---

### F-079: `cgmp_projectids` on Changes Is Comma-Separated GUIDs — No Referential Integrity
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts` (`cgmp_projectids?: string`), `src/components/pmo/ChangeForm.tsx` lines 134–142 |
| Category | Architecture |
| Priority | High |
| Complexity | High |

**Current Implementation:** `cgmp_projectids` stores a comma-separated list of project GUIDs on `cgmp_changes`: e.g., `"3fa85f64-5717-4562-b3fc-2c963f66afa6,7c9e6679-7425-40de-944b-e07fc1f90ae7"`. The form's project multi-select parses this string. There is no referential integrity — deleting a project does not remove its GUID from `cgmp_projectids` on existing changes. Querying "all changes for project X" requires loading every change record and doing client-side GUID string matching.

**Expected Implementation:** Change-to-project is an N:M relationship. Create a `cgmp_changeprojects` intersection table (or use a Dataverse N:N relationship) with `cgmp_changeid` and `cgmp_projectid` columns. The form uses `$expand` to load related projects. Deleting a project cascades to remove the intersection records.

**Root Cause:** Same pattern as `cgmp_userfavorites` (F-064) — a string field was used as a quick approximation for a relational link.

**Business Impact:** Stale project GUIDs in `cgmp_projectids` cause silent failures when loading change forms — the project is no longer found in the active projects list and disappears from the multi-select without error. The PMO cannot distinguish between "no projects assigned" and "referenced projects were deleted". At 1,000+ changes, querying by project is a multi-second client-side scan.

**Recommended Solution:** Define the `cgmp_changeprojects` N:N relationship in the Dataverse solution. Create the service class. Migrate existing data by parsing the string field and creating intersection records. Remove `cgmp_projectids` from `cgmp_changes`. Update the form project multi-select to use `$expand=cgmp_changeprojects($select=cgmp_projectid,cgmp_projectname)`.

---

### F-080: No Dataverse Solution Version Management — Schema State Is Untracked
| Field | Value |
|-------|-------|
| Module | `package.json` `deploy:schema` script, Dataverse solution package |
| Category | Architecture |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** The `deploy:schema` script deploys the Dataverse solution, but there is no automated versioning of the solution file. The solution version is set statically in the solution XML. When a schema change is deployed (adding a new option-set value, a new table, a new column), there is no migration log, no changelog, and no rollback path. The `regen` script regenerates model classes but does not record which Dataverse schema version the generated code corresponds to.

**Expected Implementation:** Implement Dataverse solution versioning using semantic versioning in the solution XML (`Major.Minor.Patch.Build`). Automate version incrementing in CI/CD (patch bump on every deployment, minor bump for schema changes, major bump for breaking changes). Maintain a `SCHEMA_CHANGELOG.md` documenting each schema version's changes. Add a solution version check on app startup — if the deployed solution version does not match the app's expected minimum version (stored as a constant in `src/utils/constants.ts`), show an Admin warning.

**Root Cause:** Solution version management was not prioritised in early development.

**Business Impact:** After a production incident it is impossible to determine exactly which version of the schema was deployed at the time. Rolling back a bad schema deployment requires manual solution XML inspection rather than reverting a versioned artifact. Multiple environments (dev/staging/prod) may be on different schema versions with no way to detect the mismatch programmatically.

**Recommended Solution:** Use Power Platform Build Tools or PAC CLI in the CI/CD pipeline to automatically increment the solution version on every deployment. Tag the git commit with the solution version. Store the deployed version in a `cgmp_applicationsettings` record and compare it to `EXPECTED_SCHEMA_VERSION` in the client app on startup.

---

### F-081: `SessionExpiredBanner` Checks `'true'` but Service Writes `'1'` — Banner Never Shows
| Field | Value |
|-------|-------|
| Module | `src/components/ui/SessionExpiredBanner.tsx` line 10, `src/generated/services/Cgmp_changesService.ts` `dispatchSessionExpiry()` |
| Category | Bug |
| Priority | High |
| Complexity | Low |

**Current Implementation:** `dispatchSessionExpiry()` in `Cgmp_changesService.ts` writes: `sessionStorage.setItem('cgmp-session-expired', '1')`. The `SessionExpiredBanner` component reads: `sessionStorage.getItem('cgmp-session-expired') === 'true'`. Because `'1' !== 'true'`, the condition is always false. The banner will never appear on page reload following a 401 or 403 authentication error, even though the session-expiry detection and storage write are working correctly. Users see a blank or partially-loaded app with no explanation.

**Expected Implementation:** Both the write and read must use the same value. Either change the write to `'true'` or change the read check to `=== '1'`. The most idiomatic pattern is `sessionStorage.setItem('cgmp-session-expired', 'true')` in `dispatchSessionExpiry()` — this requires a one-character change in the service file.

**Root Cause:** A string value inconsistency between the writer (`'1'`) and reader (`'true'`). These were likely written by different developers without cross-checking.

**Business Impact:** When a user's session expires mid-operation (401 from Dataverse), the application performs an automatic page reload but the "Your session has expired, please refresh" banner is never shown. Users experience a silent blank screen reload with no guidance, leading to support tickets and confusion. The entire session-expiry UX feature is non-functional.

**Recommended Solution:** Change `Cgmp_changesService.ts` `dispatchSessionExpiry()`: `sessionStorage.setItem('cgmp-session-expired', 'true')`. Run a grep for `'cgmp-session-expired'` across the entire codebase to ensure all readers and writers use the same value. Add an integration test asserting that a 401 response to any Dataverse call causes the banner to appear.

---

### F-082: `DeptAdmin` Role (100000007) Has No Workflow, Workspace, or UI Presence
| Field | Value |
|-------|-------|
| Module | `src/utils/roles.ts` (`EXTENDED_ROLES.DeptAdmin = 100000007`), `src/components/Sidebar.tsx`, all workspace components |
| Category | Feature Gap |
| Priority | Medium |
| Complexity | High |

**Current Implementation:** `EXTENDED_ROLES.DeptAdmin` (100000007) is defined in `roles.ts` and appears in the role code mapping. However, there is no `DeptAdminWorkspace` component, no sidebar navigation item, no `ALLOWED_TRANSITIONS` entry, and no documented intended workflow for this role. A user assigned the DeptAdmin role sees the `NoRolePage` (or the Observer view, depending on `canEdit` logic) because no workspace routes grant access to the DeptAdmin code.

**Expected Implementation:** The DeptAdmin role represents departmental administrators who should be able to: (1) Manage user profiles within their department, (2) Assign departmental observers to specific changes, (3) View reporting data scoped to their department. A `DeptAdminWorkspace` component should be created implementing this intent, with sidebar access gated to `roleCode === EXTENDED_ROLES.DeptAdmin || roleCode === ROLES.Admin`.

**Root Cause:** The DeptAdmin role was defined in the role code enumeration but its workflow design was not completed before implementation was paused.

**Business Impact:** Any user provisioned with the DeptAdmin role code (100000007) will experience the app as if they have no assigned role, creating confusion and requiring Admin intervention to re-assign them to a working role.

**Recommended Solution:** Either implement the DeptAdmin workspace (High complexity, new feature) or add DeptAdmin to an existing workspace's access list as a temporary measure. At minimum, ensure DeptAdmin users are not directed to `NoRolePage` — add role 100000007 to the Observer sidebar items as a fallback pending full implementation.

---

### F-083: PIR Approval Workflow — `Approved`/`Rejected` States Defined but Unreachable from UI
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts` (`Cgmp_changescgmp_pirstatus`: Approved=100000002, Rejected=100000003), `src/components/giicc/PIRForm.tsx` lines 56–71 |
| Category | Feature Gap |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** The `Cgmp_changescgmp_pirstatus` enum defines four states: NotStarted (100000000), Submitted (100000001), Approved (100000002), Rejected (100000003). `PIRForm.handleSave()` sets `cgmp_pirstatus: 100000001` (Submitted) when a GIICC user saves a PIR. There is no UI action in any workspace that transitions a PIR to Approved or Rejected. The ISM Workspace and Admin Dashboard display the PIR status but offer no action to change it. The `Approved` and `Rejected` states in the Dataverse option set are permanently unreachable from the application.

**Expected Implementation:** The PIR approval workflow should be defined: (1) GIICC submits the PIR (current: sets Submitted). (2) ISM reviews the PIR and sets Approved or Rejected from the ISM Workspace. (3) If Rejected, the PIR is returned to GIICC for revision. Add an ISM-visible "Approve PIR" and "Reject PIR" action pair to the ISM Workspace change detail panel, gated to `hasISMPermissions(roleCode)`.

**Root Cause:** The PIR approval workflow was designed (evidenced by the option-set values in the model) but the ISM-facing approval UI was not implemented.

**Business Impact:** All PIRs are permanently stuck in "Submitted" status. There is no recorded ISM sign-off on post-incident reviews, which is typically a governance requirement. Management reports on "PIR completion" cannot distinguish between a reviewed and an unreviewed PIR.

**Recommended Solution:** Add "Approve PIR" and "Reject PIR" action buttons to the ISM Workspace change detail panel. These buttons call `Cgmp_changesService.update({ cgmp_pirstatus: 100000002/100000003, cgmp_pir_reviewedby: currentUserProfileId, cgmp_pir_reviewedat: new Date().toISOString() })` and create a `cgmp_auditlogs` record. Add the corresponding audit fields to the `cgmp_changes` Dataverse table.

---

### F-084: ISM Sign-Off Action Not Surfaced in ISM Workspace — Fields Exist in Model
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts` (`cgmp_ismsignoffat?: string`, `cgmp_ismsignoffby?: string`), `src/components/ism/ISMWorkspace.tsx` |
| Category | Feature Gap |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** The generated model includes `cgmp_ismsignoffat` and `cgmp_ismsignoffby` fields on `cgmp_changes`, indicating that ISM sign-off was planned. However, the ISM Workspace has no "Sign Off" action button. These fields are never written by any component in the application. The `ALLOWED_TRANSITIONS` for ISM includes `UnderReview → Released` which is semantically equivalent to the sign-off decision, but the transition's write call does not populate `cgmp_ismsignoffat` or `cgmp_ismsignoffby`.

**Expected Implementation:** The ISM Workspace should surface a "Sign Off" action on changes in `UnderReview` status that: (1) Sets `cgmp_status` to `Released`. (2) Sets `cgmp_ismsignoffat` to the current timestamp. (3) Sets `cgmp_ismsignoffby` to the current user's profile GUID. (4) Appends a sign-off history entry to `cgmp_versionhistory`. (5) Creates a notification to the PMO.

**Root Cause:** The sign-off fields were added to the model in anticipation of the feature but the implementation was not completed.

**Business Impact:** The ISM sign-off is a critical governance gate between `UnderReview` and `Released`. Without recording who signed off and when, the audit trail for this critical transition is incomplete. Post-incident reviews cannot determine which ISM approved a change.

**Recommended Solution:** Add a `SignOffAction` component to `ISMWorkspace.tsx` visible for changes in `UnderReview` status when `hasISMPermissions(roleCode)`. The action handler populates the three sign-off fields and calls `canTransition(STATUS.UnderReview, STATUS.Released, roleCode)` as a guard before writing.

---

### F-085: Zero Automated Test Coverage — No Unit, Integration, or End-to-End Tests
| Field | Value |
|-------|-------|
| Module | `package.json` (no `test` script), all `src/` files |
| Category | Technical Debt |
| Priority | Critical |
| Complexity | High |

**Current Implementation:** The `package.json` contains no `test` script. There are no `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx` files anywhere in the codebase. There is no Vitest, Jest, Testing Library, Playwright, or Cypress configuration. The CI/CD pipeline (once established per F-086) has nothing to run for automated quality gates. Every change to role transition logic, SLA calculations, form validation, or audit log creation is manually verified.

**Expected Implementation:** Establish three testing layers: (1) **Unit tests** (Vitest + Testing Library) for `src/utils/` functions: `canTransition`, `calcSLA`, `isIsmFrozen`, `buildODataFilter`, `appendHistory`, `getSlaThresholdHours`. These are pure functions with no dependencies and are the highest-value testing targets. (2) **Component tests** (Vitest + Testing Library) for `ChangeForm` validation, `SessionExpiredBanner`, `RoleGuard`. (3) **E2E tests** (Playwright) for the critical path: Create Change → Submit → ITOps Review → ISM Sign-Off → GIICC Execution → Close.

**Root Cause:** Testing infrastructure was not established at project start. As complexity grew, introducing testing became progressively harder.

**Business Impact:** Any refactoring of the state machine, business logic, or form validation carries high regression risk. The `calcSLA` duplicate (F-047) is an example of a bug that a unit test would have caught immediately. The `SessionExpiredBanner` value mismatch (F-081) is a bug that an integration test would have caught at the time of the write/read implementation.

**Recommended Solution:** Phase 1: Add `vitest` and `@testing-library/react` to devDependencies. Add `"test": "vitest run"` to `package.json`. Write tests for the 10 pure utility functions in `src/utils/` — these have no React or DOM dependencies. Phase 2: Add component tests for critical path components. Phase 3: Add Playwright E2E tests for the top 3 workflows.

---

### F-086: No CI/CD Pipeline — All Deployments Are Manual PowerShell Scripts
| Field | Value |
|-------|-------|
| Module | `package.json` `deploy:app`, `deploy:schema` scripts; absence of `.github/workflows/` or Azure DevOps pipeline YAML |
| Category | Operational Excellence |
| Priority | High |
| Complexity | High |

**Current Implementation:** Deployment is performed manually by running `deploy-app.ps1` and `deploy-schema.ps1` PowerShell scripts from a developer's local machine. There is no GitHub Actions workflow, Azure DevOps pipeline, or any other CI/CD automation. There is no automated lint check, no TypeScript compilation check, and no test gate (per F-085) before deployment. A developer can deploy code that fails `tsc --noEmit` to production.

**Expected Implementation:** Establish a two-stage CI/CD pipeline: (1) **CI stage** — on every pull request: run `npm run lint`, `npm run tsc -- --noEmit`, `npm run test`, and build (`npm run build`). Block merge on failure. (2) **CD stage** — on merge to `main`: run `npm run deploy:schema` (schema-first), then `npm run deploy:app`. Use environment-specific secrets stored in the pipeline secret store, not in committed `.env` files.

**Root Cause:** The project was started as a rapid proof-of-concept. CI/CD was deferred and never revisited.

**Business Impact:** Without a CI/CD pipeline, every deployment requires a developer to be available with appropriate credentials, the correct local environment configured, and the right branch checked out. Deployment errors (wrong environment, stale local build) are not detected until users report issues in production.

**Recommended Solution:** Create `.github/workflows/ci.yml` (lint + tsc + test on PR) and `.github/workflows/cd.yml` (deploy on `main` push). Store `VITE_APPINSIGHTS_CS`, `VITE_TENANT_ID`, `VITE_ORG_URL`, and PAC CLI credentials as GitHub/ADO secrets. Add branch protection requiring CI to pass before merge.

---

### F-087: `useSystemUsers` Fetches Top 1,000 AAD Users Without Filtering — Privacy Risk
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` `useSystemUsers()` (top:1000, all non-disabled users) |
| Category | Security |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** `useSystemUsers()` calls Dataverse's `systemusers` entity with `top: 1000` and a filter for non-disabled users. This returns up to 1000 full AAD user records including display names, email addresses, job titles, and department attributes. This data is used only for Admin assignment dropdowns. Every Admin workspace mount loads 1000 user records regardless of whether the admin actually needs to assign a user.

**Expected Implementation:** Implement server-side search-as-you-type for user assignment. Replace the `top: 1000` preload with an async search function: `searchSystemUsers(query: string): Promise<SystemUser[]>` that only fires when 2+ characters are typed and returns `top: 20` results filtered by name/email. This eliminates the bulk user preload while retaining full search capability.

**Root Cause:** The preload approach was chosen to enable client-side filtering without per-keystroke API calls.

**Business Impact:** Loading 1000 user records on every Admin workspace mount transfers unnecessary PII (email addresses, display names, job titles) to the browser. In regulated industries, minimising data transfer is a compliance expectation. The 1000-record preload also contributes to Admin workspace initial load time.

**Recommended Solution:** Remove `useSystemUsers()` hook. Add `searchSystemUsers(query: string)` function to `useDataverse.ts` that fires a Dataverse query only when `query.length >= 2`. Use debounced input (per F-057 recommendation) in assignment dropdowns to call this function.

---

### F-088: Comments Soft-Delete Retains Comment Text in History Blob
| Field | Value |
|-------|-------|
| Module | `src/components/pmo/ChangeForm.tsx` `CommentsSection` — soft-delete logic |
| Category | Security |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** When a user deletes a comment, the `CommentsSection` appends a `{ _type: 'comment_deleted', id: commentId, deletedBy, deletedAt }` entry to `cgmp_versionhistory`. The original comment entry with its full `text` field remains in the history blob — it is never redacted. The original comment text is permanently readable by any user who can access `cgmp_versionhistory` (PMO, Admin, ISM who can see the history panel).

**Expected Implementation:** A true soft-delete should either: (1) **Redact the text** — on delete, find the original comment entry in the history array and replace its `text` field with `'[Comment deleted by {deletedBy} on {deletedAt}]'`, preserving the comment metadata but removing the content. (2) **Tombstone pattern** — keep the original entry but add a `deletedAt` and `deletedBy` field to it, and treat entries with `deletedAt` as deleted when rendering. Either approach prevents deleted comment text from persisting in the history.

**Root Cause:** The soft-delete was implemented as an additive event (append a delete record) rather than a mutation of the original record.

**Business Impact:** A user who posts a comment containing sensitive information (credentials, PII, confidential data) and then "deletes" it believes the information is gone. However, the comment text remains permanently in `cgmp_versionhistory` and is visible to anyone with Admin access to the Dataverse record. This is a data-retention and security concern.

**Recommended Solution:** In the delete handler, find the original comment in the history array by its `id` field. Replace `entry.text` with `'[Deleted]'`. Write the modified history back to Dataverse. Log the deletion event as a separate audit entry.

---

### F-089: No Print Layout for Change Record Detail View
| Field | Value |
|-------|-------|
| Module | `src/index.css` (no `@media print` rules), `src/components/pmo/ChangeForm.tsx`, `src/components/pmo/ChangeDetailPanel.tsx` |
| Category | Feature Gap |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** There are no `@media print` CSS rules. When a user prints a change record (Ctrl+P or browser File > Print), they get a raw rendering of the screen layout including the sidebar, header, notification bell, and all interactive controls. The print output is unusable for physical record-keeping or change approval board printouts.

**Expected Implementation:** Add a `@media print` stylesheet section to `index.css` that: (1) Hides sidebar, header, action buttons, notification panel, and tabs navigation. (2) Shows only the change detail content area in a single-column, page-flow layout. (3) Adds a print header with the change number, title, and print timestamp. (4) Expands collapsed sections (comments, history, UAT contacts) so all data appears in the printout.

**Root Cause:** Print layout was not included in the initial design scope.

**Business Impact:** Change managers in regulated industries often need physical printouts of change records for sign-off workflows. The current print output is unusable for this purpose.

**Recommended Solution:** Add a `src/styles/print.css` with `@media print` rules imported in `index.css`. Assign a `print-hide` class to Sidebar, Header, and action sections. Add a `PrintHeader` component that is hidden on screen but visible in print: `display: none; @media print { display: block; }`.

---

### F-090: Knowledge Base Full-Text Search Is Client-Side with No Debounce
| Field | Value |
|-------|-------|
| Module | `src/components/knowledge/KnowledgeBase.tsx` search input handler |
| Category | Performance |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** The Knowledge Base workspace loads all articles from Dataverse on mount (with a `top` parameter, likely top:200 or similar). The search input filters the in-memory article list on every keystroke without debounce. Each keystroke triggers a re-render of the entire article list with the new filter applied. No server-side full-text search is used.

**Expected Implementation:** Replace the keystroke-triggered client-side filter with a debounced (300ms) search that calls a Dataverse full-text search: `$search='"${escapeODataString(query)}"'` (using the Dataverse `$search` parameter for FetchXML relevance ranking). This reduces client-side render work and enables relevance-ranked results. As a minimum fix, apply the `useDebounce` hook (F-057) to the search input before filtering.

**Root Cause:** Client-side filtering with no debounce is a common quick implementation choice.

**Business Impact:** Minor performance concern on keystroke-heavy search interaction. At 200+ articles, re-filtering on every key press causes perceptible lag on lower-end machines. More importantly, client-side filtering does not support full-text search within article body content — only article titles are matched.

**Recommended Solution:** Apply `const debouncedQuery = useDebounce(searchQuery, 300)`. Use `debouncedQuery` in the filter or server-side search call rather than the raw `searchQuery`. For server-side search, call `Cgmp_knowledgearticlesService.getAll({ search: debouncedQuery, top: 20 })` when `debouncedQuery.length >= 2`.

---

### F-091: `AdminDashboard` Fires Seven Parallel `top: 1000` Queries on Every Refresh
| Field | Value |
|-------|-------|
| Module | `src/components/admin/AdminDashboard.tsx` lines 44–75 (Promise.allSettled block) |
| Category | Performance |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** `AdminDashboard.tsx` fires seven `getAll({ top: 1000 })` calls in `Promise.allSettled` every time the component mounts or the "Refresh" button is clicked: changes, bridges, users, notifications, projects, audit logs, and user profiles. Each call returns up to 1,000 records. Total data transfer on each refresh is potentially 7,000 records × average record size. There is no caching between refreshes.

**Expected Implementation:** Admin dashboard aggregate statistics should come from Dataverse `$apply` aggregate queries, not from loading full record sets. For example: `$apply=aggregate($count as totalChanges)` returns a single record with the count — no full record load required. Use count aggregates for metric tiles and only load full record sets when the Admin explicitly opens a detail view.

**Root Cause:** The `Promise.allSettled` approach was chosen for simplicity. Count aggregates via OData `$apply` were not considered.

**Business Impact:** Each Admin dashboard refresh generates 7 large Dataverse API calls simultaneously. For deployments with 1,000+ changes and 500+ users, this can take 5–10 seconds and risks Dataverse API throttling (429 responses). In high-concurrency situations (multiple Admins using the dashboard simultaneously), this can trigger service protection limits.

**Recommended Solution:** Replace full-record queries with count aggregates for metric tiles: `Cgmp_changesService.getAll({ apply: 'aggregate($count as totalChanges)' })`. Only load full records for the detail view panel opened on row click. Implement a 5-minute cache so repeated refreshes within the cache window return local data.

---

### F-092: Emergency Fast-Track SLA (4 Hours) Is Display-Only — No Server-Side Enforcement
| Field | Value |
|-------|-------|
| Module | `src/hooks/useDataverse.ts` `getSlaThresholdHours()`, `src/context/FeatureFlagsContext.tsx` |
| Category | Feature Gap |
| Priority | Medium |
| Complexity | High |

**Current Implementation:** `getSlaThresholdHours()` returns 4 if `isFeatureEnabled('emergency-fast-track')` and `change.cgmp_isemergency` are both true, otherwise 48. This is used in Dashboard stat chips and SLA indicator components to show a different threshold colour. However, the 4-hour SLA is purely a display configuration — there is no server-side timer, no automated escalation, and no notification that fires when the 4-hour threshold is breached.

**Expected Implementation:** SLA enforcement should be server-side, implemented as a scheduled Power Automate flow that: (1) Queries all changes where `cgmp_isemergency = true AND cgmp_status IN (Draft, Published, UnderReview) AND cgmp_createdon < NOW() - 4 hours`. (2) Creates a `cgmp_notifications` record for the PMO and ISM. (3) Updates a `cgmp_sla_breached` flag on the change. The client-side `getSlaThresholdHours()` reads `cgmp_sla_breached` to display the correct indicator colour.

**Root Cause:** The SLA timer was implemented as a client-side display aid. Server-side enforcement requires Power Automate flows which were not in the initial development scope.

**Business Impact:** An emergency change submitted at 09:00 with a 4-hour SLA that is not reviewed by 13:00 generates no automated escalation. The PMO and ISM must manually monitor emergency changes, which defeats the purpose of the fast-track SLA.

**Recommended Solution:** Create a Power Automate scheduled flow (every 15 minutes) implementing the query above. Create the `cgmp_sla_breached` boolean field on `cgmp_changes`. Update the client's SLA indicator to read this field. This is the appropriate separation of concerns for Power Platform: business logic automation in Power Automate, display logic in the React client.

---

### F-093: `CGMP_ERRORS` Constant Defined but Not Consistently Used — Raw String Errors in Components
| Field | Value |
|-------|-------|
| Module | `src/utils/errors.ts` (`CGMP_ERRORS` object), `src/components/pmo/ChangeForm.tsx`, `src/components/itops/ITOpsWorkspace.tsx` |
| Category | Technical Debt |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** A `CGMP_ERRORS` constant object exists in `src/utils/errors.ts` with typed error codes (e.g., `E001` through `E035` with `code`, `message`, and `resolution` fields). However, many toast error calls throughout workspace components use raw string literals rather than `CGMP_ERRORS`: `showToast('error', 'Failed to save change. Please try again.')` instead of `showToast('error', CGMP_ERRORS.E001.message)`. The error message text is inconsistent across the codebase.

**Expected Implementation:** All user-visible error messages should reference `CGMP_ERRORS`. This enables: (1) Consistent error message wording. (2) Single-point-of-change for error message updates. (3) Error code logging in Application Insights (`trackException({ properties: { cgmpErrorCode: CGMP_ERRORS.E001.code } })`). Add an ESLint rule that flags `showToast('error', '` (a string literal as the second argument) as a warning.

**Root Cause:** `CGMP_ERRORS` was defined as a centralization effort but adoption was not enforced.

**Business Impact:** Different parts of the app show different wording for the same error condition. Application Insights exception tracking cannot correlate errors by code. Support tickets reference error messages that don't match any known code.

**Recommended Solution:** Audit all `showToast('error', ...)` calls. Replace raw string literals with `CGMP_ERRORS.EXXXX.message` references. Add any missing error codes to `CGMP_ERRORS`. Enable an ESLint rule to prevent future raw strings.

---

### F-094: `cgmp_changenumber` Has No Dataverse Alternate Key — No Indexed Lookup by Number
| Field | Value |
|-------|-------|
| Module | `src/generated/models/Cgmp_changesModel.ts` (`cgmp_changenumber?: string`), all workspace filter uses of `cgmp_changenumber` |
| Category | Performance |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** `cgmp_changenumber` (e.g., "CGM-2024-0145") is the human-readable identifier for changes and is used throughout the UI for search, display, and user communication. However, it is not defined as a Dataverse alternate key and has no database index beyond what Dataverse automatically provides for text columns. Filtering by `cgmp_changenumber eq 'CGM-2024-0145'` performs a full-table scan. Similarly, `cgmp_userprincipalname` on `cgmp_userprofiles` is used as the primary lookup key for user profile matching but has no alternate key definition.

**Expected Implementation:** Define `cgmp_changenumber` as a Dataverse alternate key on the `cgmp_changes` table. This creates a unique constraint and a database index, enabling lookups by `cgmp_changenumber` to execute as indexed seeks rather than scans. Similarly, define `cgmp_userprincipalname` as an alternate key on `cgmp_userprofiles`.

**Root Cause:** Alternate keys were not defined during schema design.

**Business Impact:** At 5,000+ change records, a filter by `cgmp_changenumber` may take 500ms–2s. Every workspace that renders a search field filtering by change number performs this unindexed scan on every search. The `ISMWorkspace.tsx` ISM project dual-track lookup (display name fallback) is also an unindexed scan.

**Recommended Solution:** Add `cgmp_changenumber` as an alternate key in the Dataverse solution XML. After deploying, change search calls from `filter: "cgmp_changenumber eq '...'"` to the Dataverse alternate key lookup syntax: `retrieveByAlternateKey('cgmp_changenumber', changeNumber)`. This is a schema-level change with no application code impact beyond the lookup call.

---

### F-095: No Environment-Specific Vite Configuration — Same Build Output for Dev and Prod
| Field | Value |
|-------|-------|
| Module | `vite.config.ts`, `package.json` build script |
| Category | Operational Excellence |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** There is a single `vite.config.ts`. The `build` script is `tsc -b && vite build` with no `--mode` flag. The `vite.config.ts` does not vary behaviour by `mode`. This means that development-specific features (verbose error messages, debug logging, feature flag defaults) are not distinguished from production builds. The `import.meta.env.DEV` boolean is available at build time but no code paths branch on it in `vite.config.ts`.

**Expected Implementation:** Create `vite.config.dev.ts` (or use Vite's built-in `--mode` flag) with dev-specific settings: `sourcemap: true`, `minify: false`, a separate `outDir: 'dist-dev'`. Add `build:dev` and `build:prod` scripts. In `vite.config.ts`, use `mode` to disable source maps in production: `build: { sourcemap: mode !== 'production' }`. Add a `define` block to expose `__APP_ENV__` as a global constant for runtime environment checks.

**Root Cause:** A single Vite config was sufficient during early development and was not revisited.

**Business Impact:** Production builds may include development-mode error handling or debug logging that is not appropriate for production. Conversely, source maps (useful for production error debugging) may be absent in both environments or present where they should not be.

**Recommended Solution:** Split into `vite.config.ts` (shared), `vite.config.dev.ts`, and `vite.config.prod.ts`. Use `mergeConfig` from Vite to compose them. Add `"build:prod": "tsc -b && vite build --mode production"` and `"build:dev": "tsc -b && vite build --mode development"` to `package.json`. Enable source maps for development builds only (unless Azure Application Insights source-map upload is configured for production).

---

### F-096: CSV Export Contains All Columns Including PII Without Redaction Controls
| Field | Value |
|-------|-------|
| Module | `src/components/reporting/ReportingWorkspace.tsx` CSV export function |
| Category | Security |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** The Reports workspace CSV export button generates a CSV of all change records with all 20 columns from `useChangeList`, including `cgmp_changepoc` (point-of-contact, which may include personal email addresses and phone numbers), `cgmp_assignedlocations`, and potentially `cgmp_uatusers`. There is no column selection, no role-based field redaction, and no download audit log entry. Observer role users can also trigger the CSV export.

**Expected Implementation:** (1) Restrict CSV export to roles PMO, Admin, and GIICC. (2) Apply field-level redaction based on role: Observers should not be able to export PII fields. (3) Log every CSV export as a `cgmp_auditlogs` record: `actor, timestamp, recordCount, exportedFields`. (4) Provide a column-selection UI so users can exclude PII fields from their export.

**Root Cause:** The CSV export was implemented without a data-access policy for exported data.

**Business Impact:** Unrestricted export of POC contact data and UAT contact details constitutes a potential GDPR/data protection risk if Observers or lower-privilege users can download bulk contact lists. Without an audit log, there is no record of who exported data and when.

**Recommended Solution:** Add role checks to the export handler: `if (!['Admin', 'PMO', 'GIICC'].includes(currentRole)) return`. Exclude `cgmp_changepoc` and `cgmp_uatusers` from the default export columns. Log the export to `cgmp_auditlogs`. Add a column picker UI to the export dialog.

---

### F-097: ISM Primary Assignment Dual-Tracks GUID and Display-Name — Silent Fallback Risks
| Field | Value |
|-------|-------|
| Module | `src/components/ism/ISMWorkspace.tsx` lines 140–149 |
| Category | Bug |
| Priority | Medium |
| Complexity | Medium |

**Current Implementation:** ISM project ownership is determined by a dual-track lookup: first attempt `cgmp_primaryismid` (GUID lookup to `cgmp_userprofiles`), and if not found, fall back to display-name string matching against `cgmp_primaryismname`. The GUID-based lookup is preferred, but if the GUID is absent or does not match any active profile, the display-name fallback can silently match the wrong user if two ISM users share a common name format.

**Expected Implementation:** `cgmp_primaryismid` should be the canonical, authoritative field. The display-name fallback should be removed or only used during a migration period while all records are backfilled with correct GUIDs. The `cgmp_primaryismname` field should be treated as a denormalised display cache updated at write time, not a lookup key.

**Root Cause:** The display-name fallback was added to handle existing records that predate the GUID field. It was not removed after data migration.

**Business Impact:** If two ISM users have similar display names, the fallback can assign ownership of a project to the wrong ISM user. This user then sees change records they are not responsible for in their ISM Workspace, and the correct ISM user sees a gap in their queue.

**Recommended Solution:** Write a data migration script that backfills `cgmp_primaryismid` for all records where it is null by matching `cgmp_primaryismname` against `cgmp_userprofiles.cgmp_displayname`. After migration, remove the display-name fallback from `ISMWorkspace.tsx` lines 140–149.

---

### F-098: `App.tsx` `WORKSPACE_NAMES` and `ROUTES` Maps Are Not Type-Checked Against Each Other
| Field | Value |
|-------|-------|
| Module | `src/App.tsx` lines 130–170 (`ROUTES`, `WORKSPACE_NAMES`, `PAGE_LABELS`) |
| Category | Technical Debt |
| Priority | Low |
| Complexity | Low |

**Current Implementation:** Three separate `Record<string, string>` maps in `App.tsx` (`ROUTES`, `WORKSPACE_NAMES`, `PAGE_LABELS`) all use the same string page keys but are not enforced to be consistent with each other. A page key present in `ROUTES` but missing from `WORKSPACE_NAMES` causes the breadcrumb to show `undefined`. The F-048 finding (incorrect 'security' label) is an example of this class of inconsistency.

**Expected Implementation:** Define a string literal union type `PageKey = keyof typeof ROUTES`. Change `WORKSPACE_NAMES` and `PAGE_LABELS` types to `Record<PageKey, string>`. TypeScript will then enforce that all three maps have the same set of keys, and a missing or misnamed key will cause a compile error.

**Root Cause:** The maps were defined as plain `Record<string, string>` objects. The PageKey type was not extracted.

**Business Impact:** Low direct impact. Prevents a class of copy-paste errors when adding new workspace routes and ensures breadcrumb consistency.

**Recommended Solution:** Add `type PageKey = keyof typeof ROUTES;` to `App.tsx`. Change `const WORKSPACE_NAMES: Record<PageKey, string> = { ... }`. TypeScript will flag any missing key at compile time. Run `tsc --noEmit` to verify.

---

### F-099: `Cgmp_changehistoryService` Generated and Exported but Never Called by Any Component
| Field | Value |
|-------|-------|
| Module | `src/generated/services/Cgmp_changehistoryService.ts`, all `src/components/` files |
| Category | Technical Debt |
| Priority | High |
| Complexity | Medium |

**Current Implementation:** The `Cgmp_changehistoryService` is generated by `pac modelbuilder` and exported from the generated services index. However, a codebase-wide search confirms that `Cgmp_changehistoryService` is never imported or called by any component, hook, context, or utility. All change history is written to the `cgmp_versionhistory` JSON blob on `cgmp_changes`. The `cgmp_changehistory` Dataverse table exists and is schema-complete but receives no data from the application.

**Expected Implementation:** The `cgmp_changehistory` table should replace the `cgmp_versionhistory` blob as the audit trail for changes. Each event currently appended to the blob (edit diffs, comments, reschedule proposals, MTTR entries, sign-offs) should instead create a `cgmp_changehistory` record via `Cgmp_changehistoryService.create()`. This is a fundamental architecture fix that resolves F-009 (versionhistory blob), F-050 (blob truncation), and F-084 (ISM sign-off fields).

**Root Cause:** The `cgmp_changehistory` table was planned and schema'd but the migration from the blob approach to the relational approach was deferred.

**Business Impact:** Every issue associated with the `cgmp_versionhistory` blob (uncapped growth, truncation data loss, inability to query across changes, inability to filter by event type) is a direct consequence of this gap. The service exists and is ready to use — only the call sites need to be added.

**Recommended Solution:** Phase 1: In `appendHistory()` (`business.ts`), add a `Cgmp_changehistoryService.create()` call in parallel with the existing blob append. This writes to both systems simultaneously. Phase 2: Once all history events are being written to `cgmp_changehistory`, update the history panel UI to read from the table rather than parsing the blob. Phase 3: Deprecate `cgmp_versionhistory` field and remove blob reads from the UI.

---

### F-100: No Operational Runbook — No Documentation for Common Operational Procedures
| Field | Value |
|-------|-------|
| Module | Repository root (absence of `RUNBOOK.md`, `OPERATIONS.md`, or equivalent) |
| Category | Operational Excellence |
| Priority | Medium |
| Complexity | Low |

**Current Implementation:** The repository contains `package.json`, `.env.example`, deployment scripts, and source code, but no operational runbook. Common operational procedures are undocumented: how to rotate the App Insights connection string, how to add a new user to the system, how to promote a user's role, how to clear the feature flag state for all users, how to respond to a Dataverse API throttling incident, how to roll back a schema deployment, and how to recover from a corrupt `cgmp_versionhistory` blob.

**Expected Implementation:** Create a runbook covering at minimum: (1) User provisioning — steps to create a user profile and assign a role via Dataverse. (2) Role change procedure — steps to update a user's role code. (3) Feature flag management — how to enable/disable flags across all user localStorage (currently not possible without a centralised flag store). (4) Deployment procedure — step-by-step for a production deployment including schema and app. (5) Incident response — what to do when users report session expiry errors, when the notification bell stops updating, when the ISM workspace shows no projects. (6) Schema rollback — how to revert a Dataverse solution deployment.

**Root Cause:** Operational documentation was not prioritised during development.

**Business Impact:** The first time an incident occurs in production (e.g., all users experience session expiry, or the notification poll starts returning 429 errors), the operations team has no documented response playbook. The time-to-resolve increases significantly compared to a team with documented runbooks.

**Recommended Solution:** Create `docs/RUNBOOK.md` with the sections above. Assign ownership of runbook maintenance to the platform engineering team. Review and update the runbook with each major release.

---

## Section 4 — Production Readiness Assessment

### 4.1 Must-Fix Before Any Production Go-Live (Critical)

The following findings represent blockers that must be resolved before the platform can be considered for production use:

| Finding | Summary | Estimated Effort |
|---------|---------|-----------------|
| F-001 | Hardcoded production tenant ID in AppContext | 0.5 days |
| F-003 | localStorage feature flags bypassable by any authenticated user | 3 days |
| F-005 | CSP allows `unsafe-inline` and `unsafe-eval` in `script-src` | 1 day |
| F-009 | `cgmp_versionhistory` JSON blob grows without bound and truncates audit entries | 5 days |
| F-013 | `Cgmp_bridgesService` has no `checkForAuthError` — 401/403 errors unhandled | 0.5 days |
| F-081 | `SessionExpiredBanner` checks `'true'` but service writes `'1'` — banner never shows | 0.5 days |
| F-085 | Zero automated test coverage | 10 days (initial) |

### 4.2 Must-Fix Before Broad User Rollout (High)

These findings should be resolved before expanding the user base beyond the initial pilot group:

| Finding | Summary | Estimated Effort |
|---------|---------|-----------------|
| F-002 | Top-1000 `useChanges` fetch will fail silently beyond 1,000 records | 5 days |
| F-006 | No server-side field-level security — all access control is client-side only | 4 days |
| F-007 | `UserProfilesContext` silently fails on error — no retry, no error surface | 1 day |
| F-017 | `UserProfilesContext` top:500 cap truncates large deployments | 5 days |
| F-019 | 30-second notification polling with no backoff — fan-out at scale | 3 days |
| F-041 | App Insights AJAX/fetch tracking disabled — no API performance visibility | 0.5 days |
| F-062 | OData filter escaping inconsistently applied — injection surface | 2 days |
| F-063 | `pac modelbuilder` regen overwrites `checkForAuthError` patches | 2 days |
| F-066 | ISMDeputy absent from `ALLOWED_TRANSITIONS` — governance gap | 0.5 days |
| F-069 | No deep-link URL routing — refresh loses workspace context | 8 days |
| F-075 | Teams manifest hardcodes production IDs — multi-environment impossible | 1 day |
| F-076 | Teams manifest missing ISM Workspace tab | 0.5 days |
| F-079 | `cgmp_projectids` is comma-separated GUIDs — no referential integrity | 5 days |
| F-080 | No Dataverse solution version management | 2 days |
| F-083 | PIR `Approved`/`Rejected` states unreachable from UI | 3 days |
| F-084 | ISM sign-off action not surfaced — sign-off fields never written | 2 days |
| F-086 | No CI/CD pipeline — all deployments are manual | 5 days |
| F-091 | AdminDashboard fires 7 parallel top:1000 queries on every refresh | 3 days |
| F-099 | `Cgmp_changehistoryService` never called — audit table unused | 8 days |

### 4.3 Fix in First 90 Days Post-Launch (Medium Priority)

| Finding | Summary |
|---------|---------|
| F-004 | Logout audit log uses `beforeunload` fetch — unreliable in Teams |
| F-008 | `as never` cast in `updateUserProfile` — data may not be saved |
| F-011 | `AdminDashboard` direct `getAll()` bypass of UserProfilesContext |
| F-015 | `ROUTES` / `WORKSPACE_NAMES` not type-checked against each other |
| F-020 | Dashboard chart aggregations run un-memoised on every render |
| F-043 | `cgmp_uatusers` stored as JSON blob — should be normalised table |
| F-044 | `cgmp_assignedlocations` is semicolon-delimited string |
| F-050 | `appendHistory` trims history silently without audit or archival |
| F-054 | ISM freeze date shown as warning but does not block editing |
| F-060 | Observer `canEdit` not enforced at mutation-handler level |
| F-061 | No offline/connectivity error handling |
| F-068 | Blackout period check only on submit, not on date selection |
| F-070 | Missing `aria-required` on required form inputs |
| F-071 | Teams theme not synchronised from `microsoftTeams.app.getContext()` |
| F-072 | Modal dialogs lack focus trap — WCAG violation |
| F-073 | `beforeunload` audit log write unreliable in Teams iframe |
| F-074 | Draft restore has no expiry — stale drafts persist indefinitely |
| F-087 | `useSystemUsers` loads 1,000 AAD users without filtering |
| F-088 | Comments soft-delete retains full text in history blob |
| F-092 | Emergency SLA (4 hours) is display-only — no server-side enforcement |
| F-094 | `cgmp_changenumber` has no alternate key — unindexed search |
| F-096 | CSV export includes all columns without PII redaction |

### 4.4 Planned for Future Release Cycles

| Finding | Summary |
|---------|---------|
| F-021 | `ChangeForm.tsx` exceeds 1,200 lines — decompose into sub-components |
| F-031 | `window.confirm` for navigation guard — replace with modal |
| F-037 | DataTable lacks row virtualisation — lag at 500+ rows |
| F-043 | Normalise `cgmp_uatusers` into dedicated Dataverse table |
| F-064 | `cgmp_userfavorites` should be proper N:M Dataverse relationship |
| F-065 | Consolidate polling intervals into centralised `PollingManager` |
| F-069 | React Router deep-link routing (large refactor) |
| F-082 | DeptAdmin role has no workspace or workflow |
| F-089 | Print layout for change record detail view |
| F-090 | Knowledge Base full-text search server-side |
| F-095 | Environment-specific Vite configuration |
| F-100 | Operational runbook |

---

## Section 5 — Microsoft Power Platform Alignment

### 5.1 What Is Well Aligned

**Power Apps Code Components best practices:** The project correctly uses `@microsoft/power-apps/data` for all Dataverse access rather than raw `fetch()`. The `pac modelbuilder build` workflow generates type-safe TypeScript service and model classes from the Dataverse schema, which is the recommended approach for maintaining type consistency between the data layer and the React application layer. The `deploy:app` and `deploy:schema` scripts align with the Power Platform CLI deployment pattern.

**Application Lifecycle Management intent:** The existence of `deploy-schema.ps1` and `deploy-app.ps1` shows intent to use a code-first ALM approach. The `add-columns` script for incremental schema updates is a reasonable pattern for Dataverse schema evolution. The `.env.example` file correctly externalises all environment-specific configuration.

**Teams integration foundation:** `@microsoft/teams-js ^2.53.1` is the correct version for Teams tab hosting. The manifest structure (staticTabs, icons, developer fields) follows the Teams app manifest v1.18 schema. Application Insights integration is present for telemetry, which is required for enterprise-grade observability.

**Authentication pattern:** The reliance on Power Platform's Dataverse SDK for authentication (the SDK handles token acquisition via the Power Apps hosting context) is the correct pattern — the application does not implement its own OAuth flow, which would be a significant security concern.

### 5.2 Gaps Against Power Platform Best Practices

**Missing Dataverse field-level security profiles:** Power Platform supports column-level security on sensitive fields (e.g., `cgmp_changepoc`, `cgmp_ismsignoffby`, `cgmp_uatusers`). These should be defined in the solution with appropriate security profiles restricting write access to the appropriate roles at the Dataverse layer, independent of client-side RBAC checks.

**Missing Dataverse business rules:** Several validation rules currently enforced only in the React client (`validate()` function in `ChangeForm.tsx`) should have corresponding Dataverse server-side business rules. For example: the requirement that `cgmp_starttime < cgmp_endtime`, the restriction that `cgmp_status` can only progress forward in the lifecycle (not backward), and the requirement that `cgmp_title` is non-empty. Dataverse business rules enforce these constraints regardless of which client (Power Apps canvas, Model-Driven App, API) touches the record.

**Missing Power Automate flows for automation:** SLA breach notifications (F-092), PIR approval reminders, change window start alerts, and the ISM freeze date check should be Power Automate scheduled or trigger-based flows, not client-side polling logic. The current 30-second notification polling (F-019) is a direct consequence of having no server-side automation.

**Solution layering:** The platform should define separate Dataverse solutions for: (1) Base schema (tables, columns, option sets) — rarely changed. (2) Business logic (business rules, workflows, Power Automate flows) — changed with new features. (3) Application (the Code Component bundle) — changed with every UI release. Single-solution deployment creates coupling between schema and application changes.

**Missing Dataverse audit log configuration:** Dataverse has built-in entity-level and field-level audit logging that captures every create, update, and delete with the user, timestamp, and old/new values. This should be enabled on `cgmp_changes`, `cgmp_userprofiles`, and `cgmp_notifications` tables. This supplements (and in many cases replaces) the application-level `cgmp_auditlogs` table, which is only written by the React client and can be bypassed.

**Managed vs Unmanaged solution strategy:** Production should receive only a managed solution import (not unmanaged). Development environments work with unmanaged. This prevents schema changes directly in production Dataverse, enforcing all changes to go through the ALM pipeline.

---

## Section 6 — Recommended Architecture Evolution

### 6.1 Near-Term Architecture Target (0–6 months)

The immediate target is stabilising the current architecture by closing security gaps, adding missing infrastructure, and fixing the data model issues that would block scalability:

```
Current:                              Near-Term Target:
─────────────────────────────         ──────────────────────────────────────
React SPA                             React SPA
  ├─ 24 lazy workspaces               ├─ 24 lazy workspaces
  ├─ 3 contexts (App, UserProfiles,   ├─ 5 contexts (+ Notifications,
  │  FeatureFlags)                    │  Bridges — polling centralised)
  ├─ useDataverse hooks               ├─ useDataverse hooks
  │  (each hook independent,          │  (TanStack Query for dedup,
  │  no caching, no pagination)       │  stale-while-revalidate, pagination)
  ├─ localStorage feature flags       ├─ Dataverse-backed feature flags
  └─ SessionStorage routing           └─ React Router v7 hash routing

Dataverse:                            Dataverse:
  ├─ cgmp_versionhistory (blob)       ├─ cgmp_changehistory (table)
  ├─ cgmp_projectids (CSV string)     ├─ cgmp_changeprojects (N:N relation)
  ├─ cgmp_userfavorites (CSV string)  ├─ cgmp_userfavorites (N:N relation)
  └─ No alternate keys                └─ Alternate keys on changenumber, UPN

Power Platform:                       Power Platform:
  └─ Manual deployment                └─ CI/CD via ADO + PAC CLI
                                      └─ Power Automate flows for SLA,
                                         notifications, PIR reminders
```

### 6.2 Medium-Term Architecture Target (6–18 months)

Once the foundation is stable, the target is real-time data, proper testing, and component decomposition:

**Server-sent events / SignalR for real-time notifications:** Replace the 30-second polling with Azure SignalR Service or Dataverse webhooks → Azure Function → SignalR. Notifications appear within seconds of the triggering event. This eliminates the polling fan-out problem (F-019) permanently.

**TanStack Query as the data layer:** Replace all custom `useDataverse` hooks with TanStack Query (`useQuery`, `useMutation`, `useInfiniteQuery`). Benefits: automatic deduplication of identical queries across components, stale-while-revalidate caching, infinite scroll pagination replacing `top:` capping, and optimistic mutation updates. Migration can be done workspace by workspace without a big-bang rewrite.

**ChangeForm decomposition:** Decompose `ChangeForm.tsx` (currently 1,200+ lines) into: `ChangeFormHeader`, `ChangeFormSchedule`, `ChangeFormImpact`, `CommentsSection`, `ReschedulePanel`, `BlackoutWarning`, `AutoSaveStatus`. Each sub-component owns its own state slice and validation logic. The parent `ChangeForm` composes them and handles the final save.

**Proper E2E test suite:** Playwright tests for the top 5 critical path workflows: Create → Review → Sign Off, Emergency fast-track creation, Bridge scheduling, PIR submission, Admin role assignment. Tests run in CI/CD on every pull request targeting `main`.

### 6.3 Long-Term Architecture Vision (18+ months)

**Real-time collaborative editing:** For high-traffic change windows, multiple users editing the same change simultaneously should receive live cursor presence and field-level conflict resolution (similar to SharePoint co-authoring). This requires a presence service (Azure SignalR) and operational transformation or CRDT-based merge. The current advisory locking (10-minute audit log poll) can remain as a graceful degradation fallback.

**Power BI embedded analytics with row-level security:** Replace the current iframe embed with the Power BI Embedded service with RLS (row-level security) applied using the user's UPN and role. This ensures Observers see only aggregate data, not individual change records in reports. The Power BI datasets should be driven directly from Dataverse via the Power BI connector, eliminating the need for client-side aggregation entirely.

**Microsoft Graph integration for user directory:** Replace `useSystemUsers` (Dataverse AAD mirror) with Microsoft Graph API calls for user lookup. Graph provides real-time AAD data including presence status, manager hierarchy, and department information. This eliminates the 1,000-user preload (F-087) and enables manager-hierarchy based notifications (notify the manager when an ISM sign-off is overdue).

**Separation into Power Apps component framework (PCF) library:** Extract reusable UI components (DataTable, FormField, StatChip, RightPanel) into a PCF component library publishable to the Power Platform environment. This enables the same design system to be used in Model-Driven Apps and canvas apps within the same organisation.

---

## Section 7 — Prioritised Remediation Roadmap

### Sprint 1 — Security & Critical Bugs (2 weeks)

**Goal:** Close all Critical security gaps and fix the two highest-visibility bugs before any user-facing testing.

| ID | Task | Owner Area |
|----|------|-----------|
| F-001 | Remove hardcoded tenant ID from `AppContext.tsx`; read from `import.meta.env` | Frontend |
| F-005 | Replace `unsafe-inline`/`unsafe-eval` with nonce-based or hash-based CSP | DevOps |
| F-013 | Add `checkForAuthError` calls to `Cgmp_bridgesService` methods | Frontend |
| F-081 | Fix `SessionExpiredBanner` value mismatch (`'1'` → `'true'`) | Frontend |
| F-003 | Move feature flags from localStorage to Dataverse `cgmp_applicationsettings` | Full-stack |
| F-042 | Remove App Insights connection string localStorage fallback | Frontend |
| F-041 | Enable `disableFetchTracking: false` in App Insights config | Frontend |
| F-062 | Audit and fix all OData filter template literals — add `escapeODataString` | Frontend |

---

### Sprint 2 — Data Integrity & State Machine (2 weeks)

**Goal:** Fix the governance gaps that cause incorrect or incomplete data to be written to Dataverse.

| ID | Task | Owner Area |
|----|------|-----------|
| F-066 | Add `ISMDeputy` entry to `ALLOWED_TRANSITIONS` | Frontend |
| F-083 | Add PIR Approve/Reject actions to ISM Workspace | Frontend |
| F-084 | Add ISM Sign-Off action; populate `cgmp_ismsignoffat`/`by` | Frontend |
| F-054 | Enforce ISM freeze date as a write gate, not just a display warning | Frontend |
| F-060 | Add `canEdit` guard to all write-path mutation handlers | Frontend |
| F-050 | Archive trimmed `cgmp_versionhistory` entries to `cgmp_changehistory` before trim | Frontend |
| F-068 | Move blackout check from submit to date-picker `onChange` | Frontend |
| F-074 | Add 7-day expiry to localStorage draft saves | Frontend |

---

### Sprint 3 — Infrastructure & Deployment (2 weeks)

**Goal:** Establish the CI/CD pipeline, multi-environment deployment, and test foundation.

| ID | Task | Owner Area |
|----|------|-----------|
| F-086 | Create GitHub Actions / ADO pipelines for CI (lint, tsc, test) and CD | DevOps |
| F-075 | Replace hardcoded manifest IDs with `%%PLACEHOLDER%%` template + build script | DevOps |
| F-080 | Implement Dataverse solution semantic versioning in CI/CD | DevOps |
| F-063 | Implement service wrapper pattern to protect hand-written service additions from regen | Frontend |
| F-085 | Add Vitest; write unit tests for all 10 pure utility functions in `src/utils/` | Frontend |
| F-076 | Add ISM Workspace `staticTab` to Teams manifest | DevOps |
| F-095 | Split Vite config into dev and prod modes | Frontend |

---

### Sprint 4 — Performance & Scalability (2 weeks)

**Goal:** Address the top-N capping and uncoordinated polling that will cause production failures at scale.

| ID | Task | Owner Area |
|----|------|-----------|
| F-002 | Implement OData `nextLink` pagination in `useChanges` and `useChangeList` | Frontend |
| F-019 | Add tab-visibility pause, exponential backoff, and coordination to notification polling | Frontend |
| F-065 | Consolidate `useAllBridges` and `useNotifications` polling into `PollingManager` | Frontend |
| F-091 | Replace AdminDashboard `top:1000` queries with `$apply` aggregate queries | Frontend |
| F-087 | Replace `useSystemUsers` preload with search-as-you-type API call | Frontend |
| F-094 | Define alternate keys for `cgmp_changenumber` and `cgmp_userprincipalname` in schema | Full-stack |
| F-061 | Add `useNetworkStatus` hook and `OfflineBanner` component | Frontend |

---

### Sprint 5 — Data Model Normalisation (3 weeks)

**Goal:** Migrate the string-blob and comma-separated data fields to proper Dataverse relationships.

| ID | Task | Owner Area |
|----|------|-----------|
| F-099 | Start writing to `cgmp_changehistory` in parallel with blob; wire up history panel UI | Full-stack |
| F-079 | Define `cgmp_changeprojects` N:N relationship; migrate `cgmp_projectids` data | Full-stack |
| F-064 | Define `cgmp_userfavorites` N:M relationship; migrate string data | Full-stack |
| F-009 | After `cgmp_changehistory` write-path established: sunset `cgmp_versionhistory` blob | Full-stack |
| F-097 | Write data migration for `cgmp_primaryismid` backfill; remove display-name fallback | Full-stack |
| F-088 | Fix comment soft-delete to redact text in original history entry | Frontend |

---

### Sprint 6 — UX, Accessibility & Operational Polish (2 weeks)

**Goal:** Close the accessibility gaps, Teams integration gaps, and operational documentation.

| ID | Task | Owner Area |
|----|------|-----------|
| F-070 | Add `aria-required`, `aria-describedby` to all `ChangeForm` required inputs | Frontend |
| F-071 | Sync Teams theme via `microsoftTeams.app.getContext()` and `registerOnThemeChangeHandler` | Frontend |
| F-072 | Add focus trap to all modal dialogs (`@radix-ui/react-dialog` or `react-focus-lock`) | Frontend |
| F-069 | Implement `react-router-dom` hash routing for deep links | Frontend |
| F-073 | Replace `beforeunload` `fetch()` with `navigator.sendBeacon()` for audit log | Frontend |
| F-089 | Add `@media print` stylesheet for change record detail view | Frontend |
| F-096 | Restrict CSV export to PMO/Admin/GIICC; add PII redaction and audit log | Frontend |
| F-100 | Create `docs/RUNBOOK.md` with provisioning, deployment, and incident response sections | All |

---

### Ongoing (All Sprints)

- **F-085 (tests):** Write component tests alongside each sprint's feature work. Target 60% utility-function coverage by Sprint 3, 40% component coverage by Sprint 6.
- **F-046 (magic numbers):** Replace inline numeric option-set literals with named constants incrementally as each file is touched.
- **F-093 (CGMP_ERRORS):** Replace raw string literals with `CGMP_ERRORS` references as each component is modified.
- **F-047 (calcSLA duplicate):** Remove the ISMWorkspace local `calcSLA` during Sprint 4 ISM work.

---

## Appendix A — Finding Summary Index

| ID | Module Area | Category | Priority | Complexity |
|----|------------|---------|---------|-----------|
| F-001 | AppContext — hardcoded tenant ID | Security | Critical | Low |
| F-002 | useChanges top:1000 cap | Performance | Critical | High |
| F-003 | localStorage feature flags | Security | Critical | Medium |
| F-004 | Logout unreliable beforeunload | Bug | High | Medium |
| F-005 | CSP unsafe-inline/unsafe-eval | Security | Critical | Medium |
| F-006 | No server-side field-level security | Security | Critical | High |
| F-007 | UserProfilesContext silent fail | Bug | High | Low |
| F-008 | `as never` in updateUserProfile | Bug | High | Low |
| F-009 | cgmp_versionhistory blob design | Architecture | Critical | High |
| F-010 | UserProfilesContext 500-record cap | Performance | High | High |
| F-011 | ISMWorkspace direct service bypass | Architecture | Medium | Low |
| F-012 | useChangeList 20-column over-fetch | Performance | Medium | Medium |
| F-013 | Bridges service no authError check | Bug | Critical | Low |
| F-014 | Draft auto-save 30-60s conflict | Bug | Medium | Low |
| F-015 | Concurrent edit advisory only | Architecture | Medium | High |
| F-016 | PIR notes never trigger workflow | Feature Gap | High | Medium |
| F-017 | Profile refresh 30-min interval | Performance | Medium | Low |
| F-018 | getSlaThresholdHours flag bypass | Security | Medium | Low |
| F-019 | 30-second notification polling | Performance | High | Medium |
| F-020 | Dashboard aggregations un-memoised | Performance | Medium | Low |
| F-021 | ChangeForm.tsx 1,200+ lines | Technical Debt | High | High |
| F-022 | ISMWorkspace ISM project dual-track | Bug | Medium | Medium |
| F-023 | No pagination in DataTable | Performance | High | High |
| F-024 | Auto-clear 30-day notifications data loss | Bug | Medium | Low |
| F-025 | RightPanel emoji quick-filter labels | UI/UX | Low | Low |
| F-026 | StatChip tab filter ARIA missing | UI/UX | Medium | Low |
| F-027 | as unknown as number option-set casts | Technical Debt | Medium | Low |
| F-028 | NavigationGuard uses window.confirm | Bug | Medium | Low |
| F-029 | Empty-state design inconsistency | UI/UX | Low | Low |
| F-030 | Bridge calendar no viewport clipping | UI/UX | Medium | Medium |
| F-031 | AdminDashboard 7 parallel queries | Performance | High | Medium |
| F-032 | useAllBridges top:200 cap | Performance | Medium | Medium |
| F-033 | KnowledgeBase search no debounce | Performance | Low | Low |
| F-034 | FeatureFlags StorageEvent scope | Bug | Medium | Low |
| F-035 | SystemUsers included disabled filter | Bug | Low | Low |
| F-036 | Blackout bridge type ambiguity | Bug | Medium | Low |
| F-037 | DataTable no row virtualisation | Performance | High | High |
| F-038 | App Insights setUser PII | Security | Medium | Low |
| F-039 | ISMWorkspace no error state | Bug | Medium | Low |
| F-040 | Dashboard chart aggregations | Performance | Medium | Medium |
| F-041 | App Insights fetch tracking disabled | Operational Excellence | High | Low |
| F-042 | App Insights CS in localStorage | Security | Medium | Low |
| F-043 | cgmp_uatusers JSON blob | Architecture | High | High |
| F-044 | cgmp_assignedlocations semicolon string | Architecture | Medium | Medium |
| F-045 | cgmp_attachmentids redundant field | Architecture | Medium | Medium |
| F-046 | Magic numeric option-set codes | Technical Debt | Medium | Low |
| F-047 | calcSLA duplicated in ISMWorkspace | Technical Debt | Medium | Low |
| F-048 | NAVIGATE_COMMANDS incorrect label | Bug | Low | Low |
| F-049 | Comment edit window hardcoded 5 min | Feature Gap | Low | Low |
| F-050 | appendHistory trims silently | Bug | Medium | Low |
| F-051 | Auto-save excludes versionhistory | Bug | Medium | Low |
| F-052 | ITOps no bridge execution access | Feature Gap | Medium | Medium |
| F-053 | Reschedule proposer top-500 miss | Bug | Medium | Low |
| F-054 | isIsmFrozen display-only not enforced | Feature Gap | Medium | Medium |
| F-055 | Bridge status 'Active' vs 'InProgress' | Bug | Medium | Low |
| F-056 | No input sanitisation on text fields | Security | Medium | Low |
| F-057 | useDebounce hook inconsistently used | Technical Debt | Low | Low |
| F-058 | Notifications created with as any | Technical Debt | Medium | Low |
| F-059 | ChangeForm unnecessary as any casts | Technical Debt | Low | Low |
| F-060 | Observer canEdit not mutation-guarded | Security | High | Medium |
| F-061 | No offline/connectivity handling | Feature Gap | High | Medium |
| F-062 | OData filter escaping inconsistent | Security | High | Medium |
| F-063 | pac modelbuilder regen overwrites patches | Architecture | High | High |
| F-064 | cgmp_userfavorites CSV string | Architecture | Medium | Medium |
| F-065 | useAllBridges/useNotifications uncoordinated | Performance | Medium | Medium |
| F-066 | ISMDeputy absent from ALLOWED_TRANSITIONS | Feature Gap | High | Medium |
| F-067 | PIRForm unbounded downtimeMinutes | Bug | Low | Low |
| F-068 | Blackout check only on submit | Bug | Medium | Low |
| F-069 | No deep-link URL routing | Feature Gap | High | High |
| F-070 | Missing aria-required on form inputs | UI/UX | Medium | Low |
| F-071 | Teams theme not synchronised | UI/UX | Medium | Low |
| F-072 | Modal dialogs lack focus trap | UI/UX | Medium | Medium |
| F-073 | beforeunload audit log unreliable | Bug | Medium | Medium |
| F-074 | Draft restore no expiry | Bug | Medium | Low |
| F-075 | Manifest hardcoded production IDs | Architecture | High | Medium |
| F-076 | Manifest missing ISM tab | Feature Gap | High | Low |
| F-077 | Power BI iframe no CSP / validation | Security | Medium | Low |
| F-078 | Bridge creation optional changeid | Architecture | Medium | Low |
| F-079 | cgmp_projectids CSV GUIDs | Architecture | High | High |
| F-080 | No Dataverse solution versioning | Architecture | High | Medium |
| F-081 | SessionExpiredBanner value mismatch | Bug | High | Low |
| F-082 | DeptAdmin role no workspace or workflow | Feature Gap | Medium | High |
| F-083 | PIR Approved/Rejected states unreachable | Feature Gap | High | Medium |
| F-084 | ISM sign-off action not surfaced | Feature Gap | High | Medium |
| F-085 | Zero automated test coverage | Technical Debt | Critical | High |
| F-086 | No CI/CD pipeline | Operational Excellence | High | High |
| F-087 | useSystemUsers 1,000 user preload | Security | Medium | Medium |
| F-088 | Comment soft-delete retains text | Security | Medium | Medium |
| F-089 | No print stylesheet | Feature Gap | Low | Low |
| F-090 | KnowledgeBase search client-side | Performance | Low | Low |
| F-091 | AdminDashboard 7 × top:1000 queries | Performance | High | Medium |
| F-092 | Emergency SLA display-only | Feature Gap | Medium | High |
| F-093 | CGMP_ERRORS not consistently used | Technical Debt | Low | Low |
| F-094 | cgmp_changenumber no alternate key | Performance | Medium | Low |
| F-095 | No env-specific Vite config | Operational Excellence | Medium | Low |
| F-096 | CSV export no PII redaction | Security | Medium | Medium |
| F-097 | ISM primary ID dual-track fallback | Bug | Medium | Medium |
| F-098 | WORKSPACE_NAMES not type-checked | Technical Debt | Low | Low |
| F-099 | Cgmp_changehistoryService never called | Technical Debt | High | Medium |
| F-100 | No operational runbook | Operational Excellence | Medium | Low |

---

*End of Enterprise Review — Global Change Governance & Impact Management Platform*
*Total findings: 100 (F-001 through F-100)*
*Critical: 7 | High: 35 | Medium: 44 | Low: 14*
*Estimated total remediation effort: 24–28 weeks (2 engineers, working in parallel)*

import { ApplicationInsights } from '@microsoft/applicationinsights-web';

let ai: ApplicationInsights | null = null;

const INSTRUMENTATION_KEY_LS = 'cgmp-ai-connection-string';

export function initAppInsights(connectionString?: string): void {
  const cs =
    connectionString ??
    (import.meta.env.VITE_APPINSIGHTS_CS ||
      (() => {
        try {
          return localStorage.getItem(INSTRUMENTATION_KEY_LS) ?? '';
        } catch {
          return '';
        }
      })());
  if (!cs || ai) return;
  ai = new ApplicationInsights({
    config: {
      connectionString: cs,
      enableAutoRouteTracking: false,
      disableAjaxTracking: true,
      disableFetchTracking: true,
    },
  });
  ai.loadAppInsights();
}

/** Stores the connection string to localStorage and initialises App Insights for this session. */
export function configureAppInsights(connectionString: string): void {
  if (import.meta.env.DEV && import.meta.env.VITE_APPINSIGHTS_CS) {
    console.warn(
      '[AppInsights] VITE_APPINSIGHTS_CS env var is already set; calling configureAppInsights() will override it for this session only.'
    );
  }
  try {
    localStorage.setItem(INSTRUMENTATION_KEY_LS, connectionString);
  } catch {}
  initAppInsights(connectionString);
}

export function trackPageView(name: string): void {
  ai?.trackPageView({ name });
}

export function trackEvent(name: string, properties?: Record<string, string | number | boolean>): void {
  ai?.trackEvent({ name }, properties);
}

export function trackException(error: Error, properties?: Record<string, string | number | boolean>): void {
  ai?.trackException({ exception: error }, properties);
}

export function trackAppEvent(
  name:
    | 'change.created'
    | 'change.published'
    | 'change.closed'
    | 'bridge.started'
    | 'bridge.completed'
    | 'pir.submitted'
    | 'concern.raised'
    | 'rollback.initiated',
  properties?: Record<string, string>
): void {
  ai?.trackEvent({ name }, properties);
}

export function trackAppException(error: unknown, properties?: Record<string, string>): void {
  if (error instanceof Error) {
    ai?.trackException({ exception: error }, properties);
  }
}

export function setUser(upn: string): void {
  // Pseudonymous stable ID — same UPN always produces same 8-char ID
  const pseudoId = btoa(upn)
    .slice(0, 8)
    .replace(/[^a-zA-Z0-9]/g, '_');
  ai?.setAuthenticatedUserContext(pseudoId, undefined, true);
}

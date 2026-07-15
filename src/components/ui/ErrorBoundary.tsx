import { Component, type ErrorInfo, type ReactNode } from 'react';
import { trackException } from '../../utils/appInsights';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  workspaceName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    trackException(error, { componentStack: info.componentStack ?? '' });
    if (import.meta.env.DEV) console.error(`[ErrorBoundary:${this.props.workspaceName ?? 'unknown'}]`, error, info.componentStack);
  }

  handleReset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          role="alert"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 48, gap: 16, color: 'var(--text-secondary)', textAlign: 'center',
          }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--danger)', opacity: 0.7 }} aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>
            Something went wrong{this.props.workspaceName ? ` in ${this.props.workspaceName}` : ''}
          </div>
          <div style={{ fontSize: 13, maxWidth: 400 }}>
            {this.state.error?.message ?? 'An unexpected error occurred. Please try refreshing.'}
          </div>
          <button
            className="btn btn--primary"
            onClick={this.handleReset}
            style={{ marginTop: 8 }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

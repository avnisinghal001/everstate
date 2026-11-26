import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console useful for local development without shipping a logger.
    console.error("Everstate UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="surface" style={{ maxWidth: 620, width: "100%", padding: 28 }}>
          <div className="page-eyebrow">Something broke</div>
          <h1 className="page-title" style={{ marginBottom: 8 }}>This view could not render.</h1>
          <p className="muted" style={{ fontSize: "var(--text-subhead)", lineHeight: 1.6, marginBottom: 18 }}>
            The API may still be healthy. Reload the page, or inspect the error below and report it with the request
            that triggered it.
          </p>
          <pre className="code-block" style={{ maxHeight: 220, marginBottom: 18 }}>{this.state.error.stack || this.state.error.message}</pre>
          <div className="row">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn btn-secondary" onClick={() => window.location.assign("/")}>Back to chat</button>
          </div>
        </div>
      </div>
    );
  }
}

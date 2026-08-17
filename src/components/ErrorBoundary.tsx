import React, { Component } from "react";
import { reportTelemetry } from "../services/telemetry";

/**
 * Catches render errors and shows a recovery screen instead of leaving the user
 * on a blank white page (issue #31).
 *
 * Two things changed in #111. It now **reports** the crash rather than only
 * logging it — a white screen the user reloads past is otherwise a failure
 * nobody on the project ever hears about. And it is used at two altitudes:
 * `main.tsx` wraps the whole app (above `useAppBootstrap` and `useTheme`, which
 * used to be able to throw straight past the boundary because it was mounted
 * *inside* App), and `PageRouter` wraps each page, so a crash in Reports leaves
 * the sidebar and the running timer alive instead of blanking everything.
 *
 * `resetKey` is what makes the per-page boundary useful: navigating to another
 * page changes the key, the caught error clears, and the app is usable again
 * without a reload.
 */
interface Props {
  children: React.ReactNode;
  /** Reported verbatim to telemetry — "app", or the page that crashed. */
  scope: string;
  /** Change this to clear a caught error (PageRouter passes the page key). */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportTelemetry({
      name: "error_boundary",
      severity: "error",
      message: error.message || String(error),
      props: {
        scope: this.props.scope,
        errorName: error.name,
        // The component stack names our own components, so it says which page
        // and which subtree without carrying any of the user's data.
        componentStack: info.componentStack?.trim().split("\n").slice(0, 8).join(" < "),
      },
    });
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isPage = this.props.scope !== "app";
    return (
      <div className={`error-boundary ${isPage ? "error-boundary--page" : ""}`} role="alert">
        <div className="error-boundary__card">
          <h2 className="error-boundary__title">Something went wrong</h2>
          {/* A plain sentence, and the raw message folded away behind it. The
              raw text used to be the whole message: accurate, and useless to
              the person reading it — it named a property on an object they've
              never heard of. It still matters for support, so it's one click
              away rather than gone. */}
          <p className="error-boundary__detail">
            {isPage
              ? "This page couldn’t be displayed. Your time entries are safe — switching pages or reloading usually clears it."
              : "TimeFlow couldn’t finish loading. Your time entries are safe; reloading usually clears it."}
          </p>
          <details className="error-boundary__raw">
            <summary>Technical detail (for support)</summary>
            <p className="error-boundary__raw-text">{error.message || String(error)}</p>
          </details>
          <div className="error-boundary__actions">
            {isPage && (
              <button type="button" className="btn-ghost" onClick={this.retry}>
                Try again
              </button>
            )}
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}

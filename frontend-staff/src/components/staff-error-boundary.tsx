'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };

type State = { hasError: boolean; msg: string };

/** Падающий React в WebView иначе даёт пустой белый экран без логов у пользователя. */
export class StaffErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, msg: '' };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, msg: err?.message ?? 'Unknown error' };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[StaffErrorBoundary]', err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100dvh',
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            background: '#f8fafc',
            color: '#0f172a',
            boxSizing: 'border-box',
          }}
        >
          <p style={{ fontSize: 15, marginBottom: 12 }}>
            Не удалось отобразить приложение. Попробуйте закрыть и снова открыть из Telegram.
          </p>
          <pre
            style={{
              fontSize: 12,
              color: '#64748b',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.msg}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

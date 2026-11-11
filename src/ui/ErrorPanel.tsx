import type { CameraErrorInfo } from '../camera/errors';

export function ErrorPanel({ error, onRetry, children }: { error: CameraErrorInfo; onRetry?: () => void; children?: React.ReactNode }) {
  return (
    <div className="error-panel" role="alert">
      <div className="error-icon" aria-hidden>!</div>
      <h2>{error.title}</h2>
      <p>{error.message}</p>
      <div className="row">
        {error.canRetry && onRetry && (
          <button className="btn btn-primary" onClick={onRetry}>
            Tentar de novo
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="rounded-lg border border-danger-border bg-danger-bg p-4">
      <p className="text-sm text-danger-text">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-md bg-deep-navy px-3 py-1.5 text-sm font-medium text-white hover:bg-navy transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}

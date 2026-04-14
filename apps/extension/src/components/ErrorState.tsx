interface ErrorStateProps {
  message: string;
  isRateLimit?: boolean;
  onRetry?: () => void;
}

export function ErrorState({ message, isRateLimit, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="p-3 bg-warn-bg border border-warn-border rounded-[10px]">
      <p className="text-warn-heading text-[13px]">{message}</p>
      {isRateLimit && (
        <p className="text-text-secondary text-[11px] mt-2">
          This limit helps us keep the service free for everyone.
        </p>
      )}
      {onRetry && !isRateLimit && (
        <button
          onClick={onRetry}
          className="mt-3 h-9 px-5 bg-primary text-white font-semibold rounded-[8px] cta-glow hover:bg-primary-hover transition-colors duration-150 text-[11px]"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

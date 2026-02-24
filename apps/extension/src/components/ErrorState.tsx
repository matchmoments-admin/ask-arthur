interface ErrorStateProps {
  message: string;
  isRateLimit?: boolean;
  onRetry?: () => void;
}

export function ErrorState({ message, isRateLimit, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="p-4 bg-warn-bg border border-warn-border rounded-[4px]">
      <p className="text-warn-heading text-sm">{message}</p>
      {isRateLimit && (
        <p className="text-gov-slate text-xs mt-2">
          This limit helps us keep the service free for everyone.
        </p>
      )}
      {onRetry && !isRateLimit && (
        <button
          onClick={onRetry}
          className="mt-3 h-9 px-5 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-xs"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

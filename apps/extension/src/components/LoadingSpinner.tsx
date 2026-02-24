export function LoadingSpinner({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <div className="h-8 w-8 animate-spin rounded-full border-3 border-border-light border-t-action-teal" />
      <p className="text-sm text-gov-slate">{message ?? "Analyzing..."}</p>
    </div>
  );
}

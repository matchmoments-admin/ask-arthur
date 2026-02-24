export function LoadingSpinner({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-3 justify-center py-6">
      <div className="w-5 h-5 border-2 border-deep-navy border-t-transparent rounded-full animate-spin" />
      <p className="text-gov-slate text-sm">
        {message ?? "Analyzing..."}
      </p>
    </div>
  );
}

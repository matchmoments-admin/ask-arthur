export function LoadingSpinner({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-3 justify-center py-6">
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-text-secondary text-[13px]">
        {message ?? "Analyzing..."}
      </p>
    </div>
  );
}

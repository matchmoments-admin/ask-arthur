export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-1.5 bg-deep-navy w-full" />
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-3 border-deep-navy border-t-transparent rounded-full" />
      </div>
    </div>
  );
}

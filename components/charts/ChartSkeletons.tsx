export function DoughnutSkeleton() {
  return (
    <div className="flex justify-center">
      <div className="w-[240px] h-[240px] rounded-full border-[35px] border-gray-200 animate-pulse" />
    </div>
  );
}

export function MapSkeleton() {
  return (
    <div
      className="w-full animate-pulse rounded-lg bg-gray-200"
      style={{ aspectRatio: "273 / 253" }}
    />
  );
}

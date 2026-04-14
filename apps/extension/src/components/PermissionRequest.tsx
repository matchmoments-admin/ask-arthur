import { Shield } from "lucide-react";

interface PermissionRequestProps {
  onGrant: () => void;
  denied?: boolean;
  loading?: boolean;
}

export function PermissionRequest({
  onGrant,
  denied,
  loading,
}: PermissionRequestProps) {
  if (denied) {
    return (
      <div className="m-4 rounded-[10px] bg-surface border border-border p-4 text-center space-y-2">
        <Shield size={32} className="mx-auto text-text-muted" />
        <p className="text-[13px] font-semibold text-text-primary">
          Permission not granted
        </p>
        <p className="text-[11px] text-text-secondary leading-relaxed">
          The extension security scanner needs permission to view your installed
          extensions. You can grant access by clicking the button below.
        </p>
        <button
          onClick={onGrant}
          disabled={loading}
          className="mt-2 w-full h-9 px-5 bg-primary text-white font-semibold rounded-[8px] cta-glow hover:bg-primary-hover transition-colors duration-150 text-[11px] disabled:opacity-50"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="m-4 rounded-[10px] bg-surface border border-border p-4 text-center space-y-3">
      <Shield size={32} className="mx-auto text-primary" />
      <div className="space-y-1">
        <p className="text-[13px] font-semibold text-text-primary">
          Scan your extensions for threats
        </p>
        <p className="text-[11px] text-text-secondary leading-relaxed">
          To check your installed extensions for security risks, Ask Arthur
          needs permission to view your extension list. No data leaves your
          browser during the initial scan.
        </p>
      </div>
      <button
        onClick={onGrant}
        disabled={loading}
        className="w-full h-11 px-6 bg-primary text-white font-semibold rounded-[8px] cta-glow hover:bg-primary-hover transition-colors duration-150 text-[13px] disabled:opacity-50"
      >
        {loading ? "Requesting..." : "Grant Access"}
      </button>
      <a
        href="https://askarthur.au/help/extension-scanner"
        target="_blank"
        rel="noopener noreferrer"
        className="block text-[11px] text-primary hover:text-primary-hover hover:underline transition-colors duration-150"
      >
        Learn more about extension scanning
      </a>
    </div>
  );
}

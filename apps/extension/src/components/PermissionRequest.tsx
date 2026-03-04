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
      <div className="rounded-xl bg-surface border border-border-default p-4 text-center space-y-2">
        <Shield size={32} className="mx-auto text-slate-400" />
        <p className="text-sm font-semibold text-deep-navy">
          Permission not granted
        </p>
        <p className="text-xs text-gov-slate leading-relaxed">
          The extension security scanner needs permission to view your installed
          extensions. You can grant access by clicking the button below.
        </p>
        <button
          onClick={onGrant}
          disabled={loading}
          className="mt-2 w-full h-9 px-5 bg-deep-navy text-white font-semibold rounded-xl cta-glow hover:bg-navy transition-colors text-xs disabled:opacity-50"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface border border-border-default p-4 text-center space-y-3">
      <Shield size={32} className="mx-auto text-deep-navy" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-deep-navy">
          Scan your extensions for threats
        </p>
        <p className="text-xs text-gov-slate leading-relaxed">
          To check your installed extensions for security risks, Ask Arthur
          needs permission to view your extension list. No data leaves your
          browser during the initial scan.
        </p>
      </div>
      <button
        onClick={onGrant}
        disabled={loading}
        className="w-full h-11 px-6 bg-deep-navy text-white font-semibold rounded-xl cta-glow hover:bg-navy transition-colors text-sm disabled:opacity-50"
      >
        {loading ? "Requesting..." : "Grant Access"}
      </button>
      <a
        href="https://askarthur.au/help/extension-scanner"
        target="_blank"
        rel="noopener noreferrer"
        className="block text-xs text-action-teal-text hover:underline"
      >
        Learn more about extension scanning
      </a>
    </div>
  );
}

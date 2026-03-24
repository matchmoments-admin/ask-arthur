// Extension audit types

export interface CRXManifest {
  manifest_version: number;
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  content_scripts?: Array<{
    matches: string[];
    js?: string[];
    css?: string[];
    run_at?: string;
  }>;
  content_security_policy?:
    | string
    | { extension_pages?: string; sandbox?: string };
  web_accessible_resources?: Array<
    string | { resources: string[]; matches: string[] }
  >;
  externally_connectable?: {
    ids?: string[];
    matches?: string[];
  };
  background?: {
    service_worker?: string;
    scripts?: string[];
  };
  author?: string;
  homepage_url?: string;
  update_url?: string;
}

export type ExtCheckCategory =
  | "permissions"
  | "ai_targeting"
  | "request_interception"
  | "csp"
  | "code_integrity"
  | "publisher"
  | "data_handling"
  | "manifest";

export interface ExtensionAuditOptions {
  extensionId: string;
  /** Skip source code analysis (faster, manifest-only scan) */
  manifestOnly?: boolean;
}

import JSZip from "jszip";

interface CRXManifest {
  manifest_version: number;
  name: string;
  version: string;
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
    accepts_tls_channel_id?: boolean;
  };
  background?: {
    service_worker?: string;
    scripts?: string[];
  };
}

// CRX3 format:
// 4 bytes: magic "Cr24"
// 4 bytes: version (3)
// 4 bytes: header length
// N bytes: protobuf header (signed data)
// remaining: ZIP archive
const CRX_MAGIC = 0x34327243; // "Cr24" in little-endian
const MAX_HEADER_LENGTH = 1 * 1024 * 1024; // 1 MB
const MAX_MANIFEST_SIZE = 512 * 1024; // 512 KB
const MAX_CRX_SIZE = 50 * 1024 * 1024; // 50 MB

export async function parseCRX(buffer: ArrayBuffer): Promise<CRXManifest> {
  const view = new DataView(buffer);

  if (buffer.byteLength < 12) {
    throw new Error("Invalid CRX file: too small");
  }

  // Validate magic number
  const magic = view.getUint32(0, true);
  if (magic !== CRX_MAGIC) {
    throw new Error("Invalid CRX file: bad magic number");
  }

  // Validate version
  const version = view.getUint32(4, true);
  if (version !== 3) {
    throw new Error(`Unsupported CRX version: ${version}`);
  }

  // Header length with sanity check
  const headerLength = view.getUint32(8, true);
  if (headerLength > MAX_HEADER_LENGTH) {
    throw new Error("Invalid CRX file: header too large");
  }

  // ZIP starts after: magic (4) + version (4) + headerLen (4) + header (N)
  const zipOffset = 12 + headerLength;

  if (zipOffset >= buffer.byteLength) {
    throw new Error("Invalid CRX file: header extends beyond file");
  }

  const zipData = buffer.slice(zipOffset);

  // Extract only manifest.json from the ZIP
  const zip = await JSZip.loadAsync(zipData);
  const manifestFile = zip.file("manifest.json");

  if (!manifestFile) {
    throw new Error("No manifest.json found in CRX archive");
  }

  const manifestText = await manifestFile.async("text");
  if (manifestText.length > MAX_MANIFEST_SIZE) {
    throw new Error("manifest.json too large");
  }

  return JSON.parse(manifestText) as CRXManifest;
}

export async function fetchCRX(extensionId: string): Promise<ArrayBuffer> {
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx3&x=id%3D${encodeURIComponent(extensionId)}%26uc`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch CRX for ${extensionId}: ${response.status}`
    );
  }

  // Enforce size limit before reading into memory
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_CRX_SIZE) {
    throw new Error(`CRX too large: ${contentLength} bytes`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_CRX_SIZE) {
    throw new Error(`CRX too large: ${buffer.byteLength} bytes`);
  }

  return buffer;
}

export type { CRXManifest };

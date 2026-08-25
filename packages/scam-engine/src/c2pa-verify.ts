// C2PA / Content Credentials VALIDATION — the "signed" rung of the AI-origin
// ladder (BACKLOG "Full C2PA cryptographic validation" follow-up to
// c2pa-detect.ts).
//
// Where detectC2PA() answers "does a manifest exist" (dependency-free sniff),
// verifyC2PA() answers "does its signature hold, who signed it, what tool
// created it" via @contentauth/c2pa-node (c2pa-rs native bindings).
//
// Cost discipline: the native library is ~39 MB and Rust-backed, so it is
// (a) imported DYNAMICALLY on first use only — cold routes never pay the
// dlopen — and (b) only invoked by callers AFTER detectC2PA() found a
// manifest, so attacker-controlled bytes without a manifest never reach the
// native parser (parser-surface discipline). It must also stay OUT of the
// Next bundle: apps/web/next.config.ts lists it in serverExternalPackages.
//
// Honesty discipline (asymmetry rule): a valid signature proves the file was
// produced/edited by the named tool and unaltered since signing. An INVALID
// signature proves alteration since signing — NOT that the image is "fake".
// No result here ever speaks to images that carry no manifest at all.

export interface C2PAVerification {
  /** "trusted" = signature valid AND cert chains to the C2PA trust list;
   *  "valid" = signature cryptographically valid, issuer not on the list;
   *  "invalid" = validation failed (tampered, bad chain, expired). */
  validationState: "trusted" | "valid" | "invalid";
  /** Convenience: validationState !== "invalid". */
  signatureValid: boolean;
  /** Signing certificate CN, e.g. "Adobe Inc." */
  issuer: string | null;
  /** claim_generator, e.g. "Adobe Firefly 1.0" */
  generator: string | null;
}

interface ManifestStoreShape {
  validation_state?: string;
  active_manifest?: string;
  manifests?: Record<
    string,
    {
      claim_generator?: string;
      claim_generator_info?: Array<{ name?: string; version?: string }>;
      signature_info?: { issuer?: string };
    }
  >;
}

type ReaderModule = typeof import("@contentauth/c2pa-node");

let readerModule: Promise<ReaderModule> | null = null;

function loadModule(): Promise<ReaderModule> {
  readerModule ??= import("@contentauth/c2pa-node");
  return readerModule;
}

/**
 * Cryptographically validate the C2PA manifest in image bytes. Call only
 * after detectC2PA() reported presence. Returns null when validation could
 * not run at all (module unavailable, unreadable manifest structure) —
 * callers then fall back to presence-only copy; null is NEVER "invalid".
 */
export async function verifyC2PA(
  buf: Buffer,
  mimeType: string,
): Promise<C2PAVerification | null> {
  try {
    const { Reader } = await loadModule();
    const reader = await Reader.fromAsset({ buffer: buf, mimeType });
    if (!reader) return null;
    const store = reader.json() as ManifestStoreShape;
    const active = store.active_manifest
      ? store.manifests?.[store.active_manifest]
      : undefined;
    if (!active) return null; // no manifest the library can see — fall back

    const state = (store.validation_state ?? "").toLowerCase();
    const validationState: C2PAVerification["validationState"] =
      state === "trusted" ? "trusted" : state === "valid" ? "valid" : "invalid";

    const generatorInfo = active.claim_generator_info?.[0];
    const generator =
      (generatorInfo?.name
        ? `${generatorInfo.name}${generatorInfo.version ? ` ${generatorInfo.version}` : ""}`
        : null) ??
      active.claim_generator ??
      null;

    return {
      validationState,
      signatureValid: validationState !== "invalid",
      issuer: active.signature_info?.issuer ?? null,
      generator,
    };
  } catch {
    return null;
  }
}

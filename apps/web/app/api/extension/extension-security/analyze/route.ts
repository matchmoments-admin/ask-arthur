import { NextRequest, NextResponse } from "next/server";
import { validateExtensionRequest } from "../../_lib/auth";
import { fetchCRX, parseCRX } from "../_lib/crx-parser";
import { analyzeManifest } from "../_lib/manifest-analyzer";
import { logger } from "@askarthur/utils/logger";
import type {
  ExtensionAnalyzeResponse,
  CRXAnalysisResult,
} from "@askarthur/types";

const MAX_EXTENSIONS_PER_REQUEST = 10;

// Chrome extension IDs are 32 lowercase a-p characters
const EXTENSION_ID_RE = /^[a-p]{32}$/;

export async function POST(req: NextRequest) {
  // Authenticate
  const auth = await validateExtensionRequest(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: auth.error },
      {
        status: auth.status,
        headers: auth.retryAfter
          ? { "Retry-After": auth.retryAfter }
          : undefined,
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = body as { extensions?: unknown };
  if (
    !parsed.extensions ||
    !Array.isArray(parsed.extensions) ||
    parsed.extensions.length === 0
  ) {
    return NextResponse.json(
      { error: "extensions array is required" },
      { status: 400 }
    );
  }

  if (parsed.extensions.length > MAX_EXTENSIONS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Maximum ${MAX_EXTENSIONS_PER_REQUEST} extensions per request`,
      },
      { status: 400 }
    );
  }

  // Validate each extension entry
  const extensions: Array<{ id: string; name: string; version: string }> = [];
  for (const ext of parsed.extensions) {
    if (
      typeof ext !== "object" ||
      ext === null ||
      typeof ext.id !== "string" ||
      typeof ext.name !== "string" ||
      typeof ext.version !== "string"
    ) {
      return NextResponse.json(
        { error: "Each extension must have id, name, and version strings" },
        { status: 400 }
      );
    }
    if (!EXTENSION_ID_RE.test(ext.id)) {
      return NextResponse.json(
        { error: `Invalid extension ID format: ${ext.id}` },
        { status: 400 }
      );
    }
    extensions.push({
      id: ext.id,
      name: String(ext.name).slice(0, 200),
      version: String(ext.version).slice(0, 50),
    });
  }

  // Analyze each extension
  const results: CRXAnalysisResult[] = await Promise.all(
    extensions.map(async (ext): Promise<CRXAnalysisResult> => {
      try {
        const crxBuffer = await fetchCRX(ext.id);
        const manifest = await parseCRX(crxBuffer);
        const additionalRiskFactors = analyzeManifest(manifest);

        return {
          extensionId: ext.id,
          contentScripts: manifest.content_scripts?.map((cs) => ({
            matches: cs.matches,
            js: cs.js,
          })),
          csp:
            typeof manifest.content_security_policy === "string"
              ? manifest.content_security_policy
              : manifest.content_security_policy?.extension_pages,
          webAccessibleResources: manifest.web_accessible_resources?.map(
            (r) => (typeof r === "string" ? r : r.resources.join(", "))
          ),
          additionalRiskFactors,
        };
      } catch (err) {
        logger.warn("CRX analysis failed", {
          extensionId: ext.id,
          error: err instanceof Error ? err.message : "Unknown error",
        });

        return {
          extensionId: ext.id,
          additionalRiskFactors: [
            {
              id: "CRX_FETCH_FAILED",
              label: "Could not analyze extension package",
              severity: "MEDIUM",
              description:
                "The extension package could not be fetched from the Chrome Web Store. It may have been removed or delisted.",
            },
          ],
        };
      }
    })
  );

  const response: ExtensionAnalyzeResponse = { results };

  return NextResponse.json(response, {
    headers: {
      "X-RateLimit-Remaining": String(auth.remaining),
    },
  });
}

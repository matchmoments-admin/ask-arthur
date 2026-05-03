"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ClipboardPaste,
  Images,
  Camera,
  FolderOpen,
  ScanLine,
  BadgeCheck,
  HeartHandshake,
} from "lucide-react";
import { Drawer } from "vaul";
import { useIsMobile } from "@/hooks/useIsMobile";
import { featureFlags } from "@askarthur/utils/feature-flags";

interface ScreenshotDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilesSelected: (files: File[], mode?: "image" | "qrcode") => void;
  onScanQrCode: () => void;
  /** Optional. When supplied, the "Charity Upload Image" row becomes a
   *  file picker that loads the photo into the homepage scanner with
   *  charity-check intent set, instead of deep-linking to /charity-check.
   *  Single file only — the charity-check engine accepts one image. */
  onCharityImageSelected?: (file: File) => void;
}

export default function ScreenshotDrawer({
  open,
  onOpenChange,
  onFilesSelected,
  onScanQrCode,
  onCharityImageSelected,
}: ScreenshotDrawerProps) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const charityImageInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  // Initial value computed synchronously at mount: when the permission API is unavailable
  // we optimistically assume clipboard.read() is allowed. The effect below refines this
  // via the async permission query when available. Avoids sync setState inside useEffect.
  const [clipboardAvailable, setClipboardAvailable] = useState(() => {
    if (typeof navigator === "undefined") return false;
    const hasRead =
      !!navigator.clipboard && typeof navigator.clipboard.read === "function";
    if (!hasRead) return false;
    // If permission query isn't available, assume clipboard read is allowed.
    return !navigator.permissions || !navigator.permissions.query;
  });
  const [hasCamera, setHasCamera] = useState(false);

  useEffect(() => {
    // Check camera availability
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          setHasCamera(devices.some((d) => d.kind === "videoinput"));
        })
        .catch(() => setHasCamera(false));
    }

    // Refine clipboard availability via async permission query when supported.
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.read === "function" &&
      navigator.permissions &&
      navigator.permissions.query
    ) {
      navigator.permissions
        .query({ name: "clipboard-read" as PermissionName })
        .then((result) => {
          setClipboardAvailable(
            result.state === "granted" || result.state === "prompt"
          );
        })
        .catch(() => setClipboardAvailable(true));
    }
  }, []);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, mode?: "image" | "qrcode") => {
      const fileList = e.target.files;
      if (fileList && fileList.length > 0) {
        const files = Array.from(fileList);
        onFilesSelected(files, mode);
        onOpenChange(false);
      }
      // Reset the input so the same file can be re-selected
      e.target.value = "";
    },
    [onFilesSelected, onOpenChange]
  );

  const handleQrFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => handleFile(e, "qrcode"),
    [handleFile]
  );

  async function handleClipboardPaste() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], "clipboard-image.png", {
            type: imageType,
          });
          onFilesSelected([file]);
          onOpenChange(false);
          return;
        }
      }
    } catch {
      // User denied permission or no image in clipboard — silently ignore
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-white outline-none"
          aria-label="Choose image source"
        >
          <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-slate-300" />

          <Drawer.Title className="px-5 pt-4 pb-2 text-xs font-bold uppercase tracking-widest text-gov-slate">
            Add image or check a charity
          </Drawer.Title>

          <div className="px-3 pb-6 flex flex-col gap-1">
            {/* Paste from clipboard */}
            {clipboardAvailable && (
              <button
                type="button"
                onClick={handleClipboardPaste}
                className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
              >
                <ClipboardPaste className="text-action-teal" size={24} />
                <div>
                  <div className="text-base font-semibold text-deep-navy">
                    Paste from clipboard
                  </div>
                  <div className="text-sm text-gov-slate">
                    Use an image you&apos;ve copied
                  </div>
                </div>
              </button>
            )}

            {/* Choose from gallery */}
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
            >
              <Images className="text-action-teal" size={24} />
              <div>
                <div className="text-base font-semibold text-deep-navy">
                  Choose from gallery
                </div>
                <div className="text-sm text-gov-slate">
                  Select a screenshot or photo
                </div>
              </div>
            </button>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFile}
              className="hidden"
            />

            {/* Take a photo — mobile only */}
            {isMobile && (
              <>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
                >
                  <Camera className="text-action-teal" size={24} />
                  <div>
                    <div className="text-base font-semibold text-deep-navy">
                      Take a photo
                    </div>
                    <div className="text-sm text-gov-slate">
                      Use your camera to capture it
                    </div>
                  </div>
                </button>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFile}
                  className="hidden"
                />
              </>
            )}

            {/* Browse files */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
            >
              <FolderOpen className="text-action-teal" size={24} />
              <div>
                <div className="text-base font-semibold text-deep-navy">
                  Browse files
                </div>
                <div className="text-sm text-gov-slate">
                  Select an image file from your device
                </div>
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFile}
              className="hidden"
            />

            {/* Divider */}
            <div className="mx-3 my-1 border-t border-slate-200" />

            {/* QR Code Scanner — only shown when camera is available */}
            {hasCamera && (
              <button
                type="button"
                onClick={onScanQrCode}
                className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
              >
                <Camera className="text-action-teal" size={24} />
                <div>
                  <div className="text-base font-semibold text-deep-navy">
                    QR Code Scanner
                  </div>
                  <div className="text-sm text-gov-slate">
                    Point your camera at a QR code
                  </div>
                </div>
              </button>
            )}

            {/* QR Upload Image */}
            <button
              type="button"
              onClick={() => qrInputRef.current?.click()}
              className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
            >
              <ScanLine className="text-action-teal" size={24} />
              <div>
                <div className="text-base font-semibold text-deep-navy">
                  QR Upload Image
                </div>
                <div className="text-sm text-gov-slate">
                  Use a saved QR code from your device
                </div>
              </div>
            </button>
            <input
              ref={qrInputRef}
              type="file"
              accept="image/*"
              onChange={handleQrFile}
              className="hidden"
            />

            {/* Charity check — Upload Image lands the photo in the homepage
                scanner with charity-check intent set; Name/ABN deep-links to
                the standalone /charity-check page so both flows can be
                compared during the rollout. */}
            {featureFlags.charityCheck && (
              <>
                <div className="mx-3 my-1 border-t border-slate-200" />

                {onCharityImageSelected ? (
                  <button
                    type="button"
                    onClick={() => charityImageInputRef.current?.click()}
                    className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
                  >
                    <BadgeCheck className="text-action-teal" size={24} />
                    <div>
                      <div className="text-base font-semibold text-deep-navy">
                        Charity Upload Image
                      </div>
                      <div className="text-sm text-gov-slate">
                        Photo of a lanyard, badge, or flyer
                      </div>
                    </div>
                  </button>
                ) : (
                  <Link
                    href="/charity-check?mode=image"
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
                  >
                    <BadgeCheck className="text-action-teal" size={24} />
                    <div>
                      <div className="text-base font-semibold text-deep-navy">
                        Charity Upload Image
                      </div>
                      <div className="text-sm text-gov-slate">
                        Photo of a lanyard, badge, or flyer
                      </div>
                    </div>
                  </Link>
                )}
                <input
                  ref={charityImageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file && onCharityImageSelected) {
                      onCharityImageSelected(file);
                      onOpenChange(false);
                    }
                  }}
                  className="hidden"
                />

                <Link
                  href="/charity-check?mode=name"
                  onClick={() => onOpenChange(false)}
                  className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
                >
                  <HeartHandshake className="text-action-teal" size={24} />
                  <div>
                    <div className="text-base font-semibold text-deep-navy">
                      Charity Check Name or ABN
                    </div>
                    <div className="text-sm text-gov-slate">
                      Look up an Australian charity
                    </div>
                  </div>
                </Link>
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Drawer } from "vaul";

interface ScreenshotDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileSelected: (file: File, mode?: "image" | "qrcode") => void;
  onScanQrCode: () => void;
}

export default function ScreenshotDrawer({
  open,
  onOpenChange,
  onFileSelected,
  onScanQrCode,
}: ScreenshotDrawerProps) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [clipboardAvailable, setClipboardAvailable] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);

  useEffect(() => {
    setIsMobile(
      "ontouchstart" in window || navigator.maxTouchPoints > 0
    );

    // Check camera availability
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          setHasCamera(devices.some((d) => d.kind === "videoinput"));
        })
        .catch(() => setHasCamera(false));
    }

    // Check clipboard read availability
    if (navigator.clipboard && typeof navigator.clipboard.read === "function") {
      // Try permission query first, fall back to assuming available
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions
          .query({ name: "clipboard-read" as PermissionName })
          .then((result) => {
            setClipboardAvailable(
              result.state === "granted" || result.state === "prompt"
            );
          })
          .catch(() => {
            // Permission query not supported — assume available
            setClipboardAvailable(true);
          });
      } else {
        setClipboardAvailable(true);
      }
    }
  }, []);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, mode?: "image" | "qrcode") => {
      const file = e.target.files?.[0];
      if (file) {
        onFileSelected(file, mode);
        onOpenChange(false);
      }
      // Reset the input so the same file can be re-selected
      e.target.value = "";
    },
    [onFileSelected, onOpenChange]
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
          onFileSelected(file);
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
            Add image
          </Drawer.Title>

          <div className="px-3 pb-6 flex flex-col gap-1">
            {/* Paste from clipboard */}
            {clipboardAvailable && (
              <button
                type="button"
                onClick={handleClipboardPaste}
                className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
              >
                <span className="material-symbols-outlined text-2xl text-action-teal">
                  content_paste
                </span>
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
              <span className="material-symbols-outlined text-2xl text-action-teal">
                photo_library
              </span>
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
                  <span className="material-symbols-outlined text-2xl text-action-teal">
                    photo_camera
                  </span>
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
              <span className="material-symbols-outlined text-2xl text-action-teal">
                folder_open
              </span>
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
              onChange={handleFile}
              className="hidden"
            />

            {/* Divider */}
            <div className="mx-3 my-1 border-t border-slate-200" />

            {/* Scan with camera — only shown when camera is available */}
            {hasCamera && (
              <button
                type="button"
                onClick={onScanQrCode}
                className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
              >
                <span className="material-symbols-outlined text-2xl text-action-teal">
                  photo_camera
                </span>
                <div>
                  <div className="text-base font-semibold text-deep-navy">
                    Scan with camera
                  </div>
                  <div className="text-sm text-gov-slate">
                    Point your camera at a QR code
                  </div>
                </div>
              </button>
            )}

            {/* Upload QR image */}
            <button
              type="button"
              onClick={() => qrInputRef.current?.click()}
              className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy/20"
            >
              <span className="material-symbols-outlined text-2xl text-action-teal">
                qr_code_scanner
              </span>
              <div>
                <div className="text-base font-semibold text-deep-navy">
                  Upload QR image
                </div>
                <div className="text-sm text-gov-slate">
                  Select a saved QR code image
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
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

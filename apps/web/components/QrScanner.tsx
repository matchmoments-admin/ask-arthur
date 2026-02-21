"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { decodeQR } from "qr/decode.js";

interface QrScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (text: string) => void;
}

type ScannerState = "initializing" | "scanning" | "error";

export default function QrScanner({ open, onClose, onScan }: QrScannerProps) {
  const [state, setState] = useState<ScannerState>("initializing");
  const [errorMessage, setErrorMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const lastFallbackTime = useRef(0);
  const hasScanned = useRef(false);

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    detectorRef.current = null;
    hasScanned.current = false;
  }, []);

  const handleDetection = useCallback(
    (rawValue: string) => {
      if (hasScanned.current) return;
      hasScanned.current = true;

      // Haptic feedback on supported devices
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }

      cleanup();
      onScan(rawValue);
    },
    [cleanup, onScan]
  );

  const scanFrame = useCallback(() => {
    if (hasScanned.current) return;

    const video = videoRef.current;
    if (!video || video.readyState < video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    // Primary path: BarcodeDetector API
    if (detectorRef.current) {
      detectorRef.current
        .detect(video)
        .then((barcodes) => {
          if (hasScanned.current) return;
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            handleDetection(barcodes[0].rawValue);
            return;
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        })
        .catch(() => {
          if (!hasScanned.current) {
            rafRef.current = requestAnimationFrame(scanFrame);
          }
        });
      return;
    }

    // Fallback path: decodeQR via canvas, throttled to ~10fps
    const now = performance.now();
    if (now - lastFallbackTime.current < 100) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    lastFallbackTime.current = now;

    const canvas = canvasRef.current;
    if (!canvas) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);

    try {
      const result = decodeQR({
        data: imageData.data,
        width: w,
        height: h,
      });
      if (result) {
        handleDetection(result);
        return;
      }
    } catch {
      // decodeQR failed — continue scanning
    }

    rafRef.current = requestAnimationFrame(scanFrame);
  }, [handleDetection]);

  useEffect(() => {
    if (!open) {
      cleanup();
      setState("initializing");
      return;
    }

    hasScanned.current = false;
    setState("initializing");

    // Check for BarcodeDetector support
    if (typeof BarcodeDetector !== "undefined") {
      try {
        detectorRef.current = new BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        detectorRef.current = null;
      }
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      .then((stream) => {
        if (!videoRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        videoRef.current.play().then(() => {
          setState("scanning");
          rafRef.current = requestAnimationFrame(scanFrame);
        });
      })
      .catch((err) => {
        const msg =
          err.name === "NotAllowedError"
            ? "Camera permission was denied. Please allow camera access and try again."
            : err.name === "NotFoundError"
              ? "No camera found on this device."
              : "Could not access camera. Please try again.";
        setErrorMessage(msg);
        setState("error");
      });

    return cleanup;
  }, [open, cleanup, scanFrame]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="relative flex items-center justify-center px-4 pt-safe-top h-14 shrink-0">
        <button
          type="button"
          onClick={() => {
            cleanup();
            onClose();
          }}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close scanner"
        >
          <span className="material-symbols-outlined text-2xl">close</span>
        </button>
        <h2 className="text-white font-semibold text-base">Scan QR Code</h2>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* Video feed */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Hidden canvas for fallback decoding */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Initializing spinner */}
        {state === "initializing" && (
          <div className="relative z-10 flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-white border-t-transparent rounded-full animate-spin" />
            <p className="text-white/70 text-sm">Starting camera...</p>
          </div>
        )}

        {/* Error state */}
        {state === "error" && (
          <div className="relative z-10 flex flex-col items-center gap-4 px-8 text-center">
            <span className="material-symbols-outlined text-4xl text-white/60">
              videocam_off
            </span>
            <p className="text-white text-base">{errorMessage}</p>
            <button
              type="button"
              onClick={() => {
                cleanup();
                onClose();
              }}
              className="mt-2 px-6 py-2.5 bg-white text-deep-navy font-semibold rounded-full text-sm hover:bg-white/90 transition-colors"
            >
              Go Back
            </button>
          </div>
        )}

        {/* Scanning viewfinder overlay */}
        {state === "scanning" && (
          <>
            {/* Semi-transparent overlay with cutout effect */}
            <div className="absolute inset-0 z-10 pointer-events-none">
              {/* Top */}
              <div className="absolute top-0 left-0 right-0 bg-black/50" style={{ height: "calc(50% - 130px)" }} />
              {/* Bottom */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/50" style={{ height: "calc(50% - 130px)" }} />
              {/* Left */}
              <div className="absolute bg-black/50" style={{ top: "calc(50% - 130px)", height: "260px", left: 0, width: "calc(50% - 130px)" }} />
              {/* Right */}
              <div className="absolute bg-black/50" style={{ top: "calc(50% - 130px)", height: "260px", right: 0, width: "calc(50% - 130px)" }} />
            </div>

            {/* Viewfinder corners */}
            <div className="relative z-20 w-[260px] h-[260px] pointer-events-none">
              {/* Top-left corner */}
              <div className="absolute top-0 left-0 w-10 h-10 border-t-3 border-l-3 border-action-teal rounded-tl-lg" />
              {/* Top-right corner */}
              <div className="absolute top-0 right-0 w-10 h-10 border-t-3 border-r-3 border-action-teal rounded-tr-lg" />
              {/* Bottom-left corner */}
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-3 border-l-3 border-action-teal rounded-bl-lg" />
              {/* Bottom-right corner */}
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-3 border-r-3 border-action-teal rounded-br-lg" />
            </div>
          </>
        )}
      </div>

      {/* Bottom hint */}
      {state === "scanning" && (
        <div className="shrink-0 pb-safe-bottom px-4 pb-8 pt-4 text-center">
          <p className="text-white/70 text-sm">
            Point your camera at a QR code
          </p>
        </div>
      )}
    </div>
  );
}

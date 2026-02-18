/**
 * BarcodeDetector API type declarations.
 * Not yet included in lib.dom.d.ts.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
 */

type BarcodeFormat =
  | "aztec"
  | "code_128"
  | "code_39"
  | "code_93"
  | "codabar"
  | "data_matrix"
  | "ean_13"
  | "ean_8"
  | "itf"
  | "pdf417"
  | "qr_code"
  | "upc_a"
  | "upc_e"
  | "unknown";

interface DetectedBarcode {
  readonly boundingBox: DOMRectReadOnly;
  readonly cornerPoints: ReadonlyArray<{ x: number; y: number }>;
  readonly format: BarcodeFormat;
  readonly rawValue: string;
}

interface BarcodeDetectorOptions {
  formats?: BarcodeFormat[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats(): Promise<BarcodeFormat[]>;
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

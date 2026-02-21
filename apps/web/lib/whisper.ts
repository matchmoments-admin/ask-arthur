import OpenAI from "openai";
import { logger } from "./logger";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — Whisper API limit

export interface TranscriptionResult {
  text: string;
  durationSeconds: number;
}

const MOCK_TRANSCRIPT: TranscriptionResult = {
  text: "Hi, this is calling from the Australian Tax Office. We have detected suspicious activity on your tax file number. You need to make an immediate payment of $3,000 via gift cards to avoid arrest. Please stay on the line and do not hang up. Your TFN has been compromised and a warrant has been issued. Press 1 to speak to our enforcement officer.",
  durationSeconds: 42,
};

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 * - Fail-closed in production (throws if no API key)
 * - Returns mock transcript in dev when OPENAI_API_KEY is not set
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string
): Promise<TranscriptionResult> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`Audio file exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB Whisper limit`);
  }

  if (!process.env.OPENAI_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      logger.error("OPENAI_API_KEY not set in production — refusing to serve mock");
      throw new Error("Transcription service unavailable.");
    }
    logger.warn("OPENAI_API_KEY not set — returning mock transcription");
    return { ...MOCK_TRANSCRIPT };
  }

  const client = new OpenAI();

  const blob = new Blob([new Uint8Array(buffer)], { type: "audio/mpeg" });
  const file = new File([blob], filename, { type: "audio/mpeg" });

  const response = await client.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
  });

  const text = response.text || "";
  const durationSeconds = response.duration ?? 0;

  logger.info("Whisper transcription complete", {
    filename,
    durationSeconds,
    textLength: text.length,
  });

  return { text, durationSeconds };
}

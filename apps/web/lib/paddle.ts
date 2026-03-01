import { Paddle, Environment } from "@paddle/paddle-node-sdk";

let paddleInstance: Paddle | null = null;

export function getPaddleClient(): Paddle | null {
  if (paddleInstance) return paddleInstance;

  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) return null;

  const env =
    process.env.NEXT_PUBLIC_PADDLE_ENV === "production"
      ? Environment.production
      : Environment.sandbox;

  paddleInstance = new Paddle(apiKey, { environment: env });
  return paddleInstance;
}

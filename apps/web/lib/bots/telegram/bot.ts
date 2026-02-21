import { Bot } from "grammy";
import { registerHandlers } from "./handlers";

const token = process.env.TELEGRAM_BOT_TOKEN;

// Use a placeholder token at build time — the route handler checks for a real token at runtime
export const bot = new Bot(token || "placeholder:token");

if (token) {
  registerHandlers(bot);
}

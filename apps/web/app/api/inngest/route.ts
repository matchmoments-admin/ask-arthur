import { serve } from "inngest/next";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { inngestFunctions } from "@askarthur/scam-engine/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});

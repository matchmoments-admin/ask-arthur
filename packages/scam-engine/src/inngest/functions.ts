// Inngest function registry — all pipeline functions exported as a single array
// for the serve() handler.

import { stalenessCheck } from "./staleness";
import { stalenessCheckIPs } from "./staleness-ips";
import { stalenessCheckWallets } from "./staleness-wallets";
import { enrichmentFanOut } from "./enrichment";
import { ctMonitor } from "./ct-monitor";

export const inngestFunctions = [
  stalenessCheck,
  stalenessCheckIPs,
  stalenessCheckWallets,
  enrichmentFanOut,
  ctMonitor,
];

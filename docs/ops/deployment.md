# Deployment

| Platform  | Target                 | Config                                                                                                                                                                                                        |
| --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app   | Vercel                 | Root: `apps/web`, Build: `cd ../.. && pnpm turbo build --filter=@askarthur/web`                                                                                                                               |
| Extension | Chrome Web Store       | Minimal v1.0.0: `pnpm --filter @askarthur/extension zip`. Full-featured v1.0.1 (with Facebook ads): `WXT_FACEBOOK_ADS=true pnpm --filter @askarthur/extension zip`. New host permissions → 1–3 day re-review. |
| Mobile    | App Store / Play Store | EAS Build via Expo                                                                                                                                                                                            |
| Pipeline  | GitHub Actions         | Scheduled cron, gated by `ENABLE_SCRAPER`                                                                                                                                                                     |
| Bots      | Vercel (webhooks)      | Webhook URLs registered per platform                                                                                                                                                                          |

For the standard ship workflow (the 10 steps for a code+schema change), see [ship-workflow.md](./ship-workflow.md).

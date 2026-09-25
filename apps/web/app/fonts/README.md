# Self-hosted fonts

Latin-subset woff2 files for every family the web app uses, loaded with
`next/font/local` so builds never fetch from Google Fonts (issue #1242 — the
build-time fetch failed intermittently and broke CI and Vercel builds).

Files were taken from the Google Fonts CSS2 API's `latin` subset — the same
subset `next/font/google` was configured with (`subsets: ["latin"]`). Variable
families are one file covering the weight range in use; IBM Plex Mono is static
(one file per weight).

All families are licensed under the SIL Open Font License 1.1; each family's
licence text is in `licenses/`.

To refresh a family: request
`https://fonts.googleapis.com/css2?family=<Family>:wght@<min>..<max>&display=swap`
with a modern browser User-Agent and take the `/* latin */` block's woff2 URL.

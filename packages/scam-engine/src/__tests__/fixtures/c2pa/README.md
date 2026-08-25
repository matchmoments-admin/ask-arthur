# C2PA test fixtures

- `signed-valid.jpg` — the `C.jpg` test fixture from
  [contentauth/c2pa-rs](https://github.com/contentauth/c2pa-rs)
  (`sdk/tests/fixtures/C.jpg`, Apache-2.0/MIT dual-licensed), carrying a
  manifest signed with the **C2PA Test Signing Cert**. Its validation state
  is `Valid` (signature holds; the test cert is not on the production trust
  list, so never expect `Trusted` from it).

The tampered variant is generated in-test by flipping a byte in the
entropy-coded pixel data — committing a corrupted binary would invite
"fixing" by a well-meaning tool.

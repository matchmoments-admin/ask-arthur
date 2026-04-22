// Flat-config for pure Node / TypeScript packages (bot-core, utils, etc.).
// Thin re-export of the shared base — same unused-vars convention and shared
// ignore globs. Packages that need the full typescript-eslint recommended set
// should install `typescript-eslint` and extend this with `tseslint.configs.recommended`.

import base from "./base.js";

export default base;

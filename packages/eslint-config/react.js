// Flat-config for React apps that aren't Next.js (e.g. @askarthur/extension
// with WXT). Extends base with React / react-hooks / jsx-a11y when those
// plugins are installed by the consuming package.
//
// NOTE: currently a thin re-export of the base. Consuming packages should
// install eslint-plugin-react / react-hooks / jsx-a11y themselves and extend
// this config via their own eslint.config.mjs until this shared config gains
// a hard dependency on those plugins.

import base from "./base.js";

export default base;

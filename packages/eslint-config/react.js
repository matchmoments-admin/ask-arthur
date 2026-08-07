// Flat-config for React apps that aren't Next.js (e.g. @askarthur/extension
// with WXT, @askarthur/mobile with Expo). Same parser/plugin registration and
// shared rules as the node config; React-specific plugins (react, react-hooks,
// jsx-a11y) are still the consuming package's responsibility to install and
// layer on top via its own eslint.config.mjs until this shared config gains a
// hard dependency on them.

import node from "./node.js";

export default node;

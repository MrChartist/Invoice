/**
 * R6-A4: the app version, read from `package.json` at build time (`define: { __APP_VERSION__ }` in
 * `vite.config.ts`). Help, the diagnostic report and What's new read it from here. Under `node:test` the
 * define does not exist, so a dev value is used.
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

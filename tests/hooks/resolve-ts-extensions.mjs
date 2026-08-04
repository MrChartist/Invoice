/**
 * Node's native ESM resolver requires explicit file extensions on relative
 * specifiers, but the app source (bundled by Vite/tsc) imports extensionless
 * throughout (e.g. `./invoice-calc`). This hook tries `.ts`/`.tsx` when a bare
 * relative specifier doesn't resolve on its own, so `node --test` can run
 * against the real source tree without rewriting every import.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const EXTENSIONS = ['.ts', '.tsx'];

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
    const baseDir = path.dirname(fileURLToPath(context.parentURL));
    for (const ext of EXTENSIONS) {
      const candidate = path.resolve(baseDir, specifier + ext);
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}

/* Where the Claude CLI binary lives. Left to itself the SDK resolves the
   platform package with require.resolve + existsSync — both asar-patched in
   Electron, so in a packaged app they cheerfully answer with a path inside
   app.asar. child_process.spawn is not patched, and an archive is a file, so
   the launch dies with ENOTDIR while the asarUnpack copy sits unused next
   door. Resolving here and pointing at the unpacked mirror is the fix; in
   dev the path holds no app.asar and passes through untouched. */
import { createRequire } from 'node:module';

const PLATFORM_PACKAGE = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
const BINARY = process.platform === 'win32' ? 'claude.exe' : 'claude';

export function outsideAsar(path: string): string {
  return path.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
}

export function claudeCliPath(): string {
  const require = createRequire(import.meta.url);
  return outsideAsar(require.resolve(`${PLATFORM_PACKAGE}/${BINARY}`));
}

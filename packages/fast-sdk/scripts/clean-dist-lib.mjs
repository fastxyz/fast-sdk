import { lstat, rm } from 'node:fs/promises';

/** Remove a real dist directory while refusing links and non-directories. */
export async function cleanDist(dist) {
  let stat;
  try {
    stat = await lstat(dist);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return;
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to clean symlinked dist path: ${dist}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Refusing to clean non-directory dist path: ${dist}`);
  }
  await rm(dist, { recursive: true });
}

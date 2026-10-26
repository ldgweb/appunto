// Scratch data folders for the runs in this directory.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Empties `dir` for a run. Refuses a folder outside the temp folder that
 *  already holds a board: it could be someone's real notes. */
export function freshScratchDir(dir) {
  const full = resolve(dir);
  const fromTemp = relative(resolve(tmpdir()), full);
  const inTemp = fromTemp !== '' && !fromTemp.startsWith('..') && !isAbsolute(fromTemp);
  if (!inTemp && existsSync(join(full, 'board.json'))) {
    console.error(`${full} holds a board and is not a temporary folder. Pick an empty scratch folder.`);
    process.exit(2);
  }
  rmSync(full, { recursive: true, force: true });
  mkdirSync(full, { recursive: true });
  return full;
}

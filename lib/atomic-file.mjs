import {
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

export function writeFileAtomic(filePath, content, options = {}) {
  const target = String(filePath);
  const directory = dirname(target);
  const temporary = join(
    directory,
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const renameFile = options.renameFile || renameSync;

  mkdirSync(directory, { recursive: true });

  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    renameFile(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }

  return target;
}

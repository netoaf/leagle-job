#!/usr/bin/env node

import { dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { rebuildJobIndex } from './lib/job-index.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const result = rebuildJobIndex(projectRoot);

console.log(`Rebuilt job index: ${result.count} record(s)`);
console.log(`File: ${relative(projectRoot, result.file)}`);

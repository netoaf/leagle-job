import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export function loadYamlFile(filePath) {
  return parseYaml(readFileSync(filePath, 'utf-8'));
}

export function loadJobFinderConfigs(projectRoot) {
  const candidateContextPath = join(projectRoot, 'config', 'candidate-context.yml');
  return {
    profile: loadYamlFile(join(projectRoot, 'config', 'profile.yml')),
    scoring: loadYamlFile(join(projectRoot, 'config', 'scoring.yml')),
    rules: loadYamlFile(join(projectRoot, 'config', 'jobfinder-rules.yml')),
    candidate_context: existsSync(candidateContextPath) ? loadYamlFile(candidateContextPath) : {},
  };
}

export function parseYaml(input) {
  const lines = preprocess(input);
  if (lines.length === 0) return {};
  const [value, index] = parseBlock(lines, 0, lines[0].indent);
  if (index < lines.length) {
    throw new Error(`Unexpected YAML content at line ${lines[index].lineNumber}: ${lines[index].text}`);
  }
  return value ?? {};
}

function preprocess(input) {
  return input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((raw, i) => ({ raw: stripInlineComment(raw.replace(/\t/g, '  ')), lineNumber: i + 1 }))
    .map(({ raw, lineNumber }) => {
      const trimmedRight = raw.trimEnd();
      const text = trimmedRight.trim();
      if (!text) return null;
      const indent = trimmedRight.length - trimmedRight.trimStart().length;
      return { indent, text, lineNumber };
    })
    .filter(Boolean);
}

function stripInlineComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quote) {
      if (char === quote && raw[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function parseBlock(lines, index, indent) {
  if (index >= lines.length || lines[index].indent < indent) return [null, index];
  if (lines[index].indent !== indent) {
    throw new Error(`Invalid indentation at line ${lines[index].lineNumber}`);
  }
  return lines[index].text.startsWith('- ')
    ? parseSequence(lines, index, indent)
    : parseMap(lines, index, indent);
}

function parseSequence(lines, index, indent) {
  const result = [];

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith('- ')) break;

    const rest = line.text.slice(2).trim();
    index++;

    if (rest === '') {
      if (index < lines.length && lines[index].indent > indent) {
        const [child, nextIndex] = parseBlock(lines, index, lines[index].indent);
        result.push(child);
        index = nextIndex;
      } else {
        result.push(null);
      }
      continue;
    }

    if (looksLikeKeyValue(rest)) {
      const item = {};
      const [key, valueText] = splitKeyValue(rest, line.lineNumber);
      if (valueText === '') {
        if (index < lines.length && lines[index].indent > indent) {
          const [child, nextIndex] = parseBlock(lines, index, lines[index].indent);
          item[key] = child;
          index = nextIndex;
        } else {
          item[key] = {};
        }
      } else {
        item[key] = parseScalar(valueText);
      }

      if (index < lines.length && lines[index].indent > indent) {
        const [merged, nextIndex] = parseMap(lines, index, lines[index].indent, item);
        result.push(merged);
        index = nextIndex;
      } else {
        result.push(item);
      }
      continue;
    }

    result.push(parseScalar(rest));
  }

  return [result, index];
}

function parseMap(lines, index, indent, seed = {}) {
  const result = seed;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) break;
    if (line.text.startsWith('- ')) break;

    const [key, valueText] = splitKeyValue(line.text, line.lineNumber);
    index++;

    if (valueText === '') {
      if (index < lines.length && lines[index].indent > indent) {
        const [child, nextIndex] = parseBlock(lines, index, lines[index].indent);
        result[key] = child;
        index = nextIndex;
      } else {
        result[key] = {};
      }
    } else {
      result[key] = parseScalar(valueText);
    }
  }

  return [result, index];
}

function looksLikeKeyValue(text) {
  const colon = findUnquotedColon(text);
  if (colon <= 0) return false;
  const key = text.slice(0, colon).trim();
  return /^[A-Za-z0-9_.-]+$/.test(key);
}

function splitKeyValue(text, lineNumber) {
  const colon = findUnquotedColon(text);
  if (colon <= 0) throw new Error(`Expected key/value pair at line ${lineNumber}: ${text}`);
  const key = text.slice(0, colon).trim();
  const value = text.slice(colon + 1).trim();
  if (!key) throw new Error(`Missing key at line ${lineNumber}`);
  return [key, value];
}

function findUnquotedColon(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ':') return i;
  }
  return -1;
}

function parseScalar(value) {
  const text = value.trim();
  if (text === '') return '';
  if (text === '[]') return [];
  if (text === '{}') return {};

  const lower = text.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null') return null;

  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);

  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return unquote(text);
  }

  return text;
}

function unquote(text) {
  if (text.startsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return text
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

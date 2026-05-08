/**
 * react-native `Pressable` → `GinitPressable` (중복 클릭 방지 기본 적용)
 * 실행: node scripts/codemod-ginit-pressable.mjs
 */
import fs from 'fs';
import path from 'path';

const roots = ['app', 'components', 'src'].filter((d) => fs.existsSync(path.join(process.cwd(), d)));
const skipFiles = new Set([
  path.join(process.cwd(), 'components/ui/GinitPressable.tsx'),
]);

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'build' || ent.name === '.git') continue;
      yield* walk(p);
    } else if (ent.isFile() && (ent.name.endsWith('.tsx') || ent.name.endsWith('.ts'))) {
      yield p;
    }
  }
}

function stripPressableFromNamedImport(inner) {
  const parts = inner.split(',').map((s) => s.trim()).filter(Boolean);
  const kept = parts.filter((seg) => {
    const withoutType = seg.replace(/^type\s+/, '');
    const name = withoutType.split(/\s+as\s+/)[0].trim();
    return name !== 'Pressable';
  });
  return kept.join(', ');
}

function transformFile(absPath) {
  if (skipFiles.has(absPath)) return false;
  let text = fs.readFileSync(absPath, 'utf8');
  if (!/\bPressable\b/.test(text)) return false;
  if (!text.includes('<Pressable') && !text.includes('</Pressable>')) return false;

  let next = text.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*(['"])react-native\2/g,
    (full, inner) => {
      if (!/\bPressable\b/.test(inner)) return full;
      const stripped = stripPressableFromNamedImport(inner);
      if (!stripped.trim()) return full;
      const q = full.match(/from\s*(['"])/)[1];
      return `import {${stripped}} from ${q}react-native${q}`;
    },
  );

  if (next === text) return false;

  if (!next.includes("from '@/components/ui/GinitPressable'")) {
    const firstImport = next.match(/^import\s/m);
    if (firstImport) {
      next = `import { GinitPressable } from '@/components/ui/GinitPressable';\n` + next;
    } else {
      next = `import { GinitPressable } from '@/components/ui/GinitPressable';\n` + next;
    }
  }

  next = next.replace(/<Pressable\b/g, '<GinitPressable');
  next = next.replace(/<\/Pressable>/g, '</GinitPressable>');

  if (next === text) return false;
  fs.writeFileSync(absPath, next, 'utf8');
  return true;
}

let n = 0;
for (const root of roots) {
  const base = path.join(process.cwd(), root);
  for (const file of walk(base)) {
    if (transformFile(file)) {
      n += 1;
      console.log(file);
    }
  }
}
console.log(`Updated ${n} files.`);

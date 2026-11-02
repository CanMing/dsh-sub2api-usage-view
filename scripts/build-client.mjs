import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
let source = fs.readFileSync(new URL('client.js', root), 'utf8').replace(/\r\n?/g, '\n');
const exported = [];
// The client deliberately uses only external static imports and named declarations.
source = source.replace(/^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2\s*;[ \t]*\n/gm, (_all, bindings, _quote, specifier) => {
  const clause = bindings.trim();
  const module = `require(${JSON.stringify(specifier)})`;
  if (clause.startsWith('{')) return `const ${clause.replace(/\bas\b/g, ':')} = ${module};\n`;
  if (/^[A-Za-z_$][\w$]*$/u.test(clause)) return `const ${clause} = ${module};\n`;
  throw new Error(`Unsupported client import declaration: ${clause}`);
});
source = source.replace(/^export\s+(?=(?:async\s+)?(?:const|let|class|function)\s+([A-Za-z_$][\w$]*))/gm, (_all, name) => { exported.push(name); return ''; });
if (/^\s*(?:import|export)\b/m.test(source)) throw new Error('Unsupported ESM syntax in client.js');
if (!exported.includes('apply')) throw new Error('Client must export apply');
const output = `// Generated from client.js by scripts/build-client.mjs.\nwindow.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory(require) {\n${source}\n    return { ${exported.join(', ')} };\n  }\n});\n`;
new vm.Script(output, { filename: 'lib/client.js' });
fs.mkdirSync(new URL('lib/', root), { recursive: true });
fs.writeFileSync(new URL('lib/client.js', root), output);
console.log(`Built DSH classic client module: ${manifest.name}`);

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require(process.env.TYPESCRIPT_PATH || 'typescript'); }
catch {
  console.error('TypeScript compiler unavailable. Set TYPESCRIPT_PATH to an existing typescript.js; set NODE_TYPES_ROOT to the directory containing @types/node when needed.');
  process.exit(2);
}
const options = {
  strict: true, noEmit: true, target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext, allowImportingTsExtensions: true,
  erasableSyntaxOnly: true, types: ['node'],
  ...(process.env.NODE_TYPES_ROOT ? { typeRoots: [process.env.NODE_TYPES_ROOT] } : {}),
};
const files = ['src', 'tests', 'scripts'].flatMap(dir => ts.sys.readDirectory(dir, ['.ts']));
const program = ts.createProgram(files, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: name => name,
    getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else console.log(`TypeScript ${ts.version}: ${files.length} files passed (strict, noEmit).`);

# extensionless-imports

Remove .ts, .tsx, .js, and .jsx suffixes from local JavaScript and
TypeScript module specifiers without reformatting the rest of the file.

    - import { Button } from "./Button.tsx";
    + import { Button } from "./Button";

The package includes a command-line interface and a small programmatic API.

> **Compatibility warning**
>
> Native Node.js ESM and browsers generally require explicit extensions for
> relative imports. Use this package only when your bundler, framework, or
> module resolver supports extensionless imports. Preview and check modes make
> it possible to review changes before writing them.

## Installation

Install it in a project:

    npm install --save-dev extensionless-imports

Or run it without adding a dependency:

    npx extensionless-imports src

## CLI

Preview changes without modifying files:

    npx extensionless-imports src test

Write changes:

    npx extensionless-imports --write src test

Check in CI and exit with status 1 when changes are required:

    npx extensionless-imports --check src test

Process package subpaths as well as local paths:

    npx extensionless-imports --write --include-package-subpaths src

Ignore files or directories with repeatable glob patterns:

    npx extensionless-imports --ignore "**/*.test.ts" --ignore "src/generated/**" src

Scan only a custom comma-separated set of source extensions:

    npx extensionless-imports --extensions ts,tsx src

Show the active configuration, discovery results, unchanged files, and
replacement counts:

    npx extensionless-imports --verbose src

Automatically rewrite matching imports whenever a source file is saved:

    npx extensionless-imports --write --watch src

Full usage:

    Usage: extensionless-imports [options] [files or directories...]

    Options:
      --write                      Update files in place
      --check                      Exit with code 1 when changes are needed
      --include-package-subpaths   Also rewrite package subpaths
      --ignore <pattern>           Ignore a glob pattern (repeatable)
      --extensions <list>          Scan comma-separated extensions
      --verbose                    Show discovery and processing details
      --watch                      Rewrite files automatically after save
      -h, --help                   Show help
      -v, --version                Show the package version

When no path is supplied, the CLI scans the current directory. It ignores
.git, node_modules, dist, and coverage directories.

Ignore patterns use forward-slash paths relative to the directory where the
command is run. Quote glob patterns so the shell passes them unchanged.

The default scanned extensions are .ts, .tsx, .js, .jsx, .mts, .cts, .mjs,
and .cjs. The --extensions option changes only which source files are scanned;
the transformer still removes only .ts, .tsx, .js, and .jsx from imports.

### Watch mode

Watch mode runs the normal write pass once, then stays active and processes
matching files after they are created or saved:

    npx extensionless-imports --write --watch src

The --watch option requires --write and cannot be combined with --check.
Ignore patterns, extension filters, package-subpath handling, and verbose
output all apply to watched changes. Press Ctrl+C to stop watching cleanly.

The watcher waits briefly for a save to finish and serializes repeated events
for the same file. This avoids processing incomplete editor writes and
prevents overlapping rewrites.

### Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | The command completed successfully |
| 1 | Check mode found files that require changes |
| 2 | Arguments, source parsing, or filesystem processing failed |

## API

### stripImportExtensions

Transform a source string without accessing the filesystem:

    import { stripImportExtensions } from "extensionless-imports";

    const output = stripImportExtensions(
      'import value from "./value.ts";',
    );

    // import value from "./value";

Package subpaths are unchanged by default. They can be enabled explicitly:

    stripImportExtensions(source, {
      includePackageSubpaths: true,
    });

### processFile

Preview a file:

    import { processFile } from "extensionless-imports";

    const result = await processFile("src/example.ts");

Write a file:

    await processFile("src/example.ts", { write: true });

The result reports the absolute path, whether the file changed, the number of
replacements, and whether content was written.

The check and write options are mutually exclusive.

### findSourceFiles

Discover supported source files:

    import { findSourceFiles } from "extensionless-imports";

    const files = await findSourceFiles("src");

Additional directory names can be ignored:

    const files = await findSourceFiles(".", {
      ignoredDirectories: ["generated", "vendor"],
    });

Use the same glob and extension filtering available in the CLI:

    const files = await findSourceFiles(".", {
      baseDirectory: process.cwd(),
      ignorePatterns: ["**/*.test.ts", "src/generated/**"],
      extensions: ["ts", "tsx"],
    });

## Supported syntax

The transformer handles statically analyzable module specifiers in:

- Default, named, namespace, and type-only imports
- Side-effect imports
- Named and star re-exports
- String-literal dynamic imports

Examples:

    import value from "./value.ts";
    import type { User } from "./User.ts";
    import "./setup.js";
    export { Button } from "./Button.tsx";
    export * from "./utilities.js";
    const page = import("./Page.jsx");

Query strings and fragments are preserved:

    import raw from "./file.ts?raw";
    // becomes "./file?raw"

    import preview from "./Component.tsx#preview";
    // becomes "./Component#preview"

## Intentionally unchanged

The package does not modify:

- Ordinary strings and comments
- JSON, CSS, images, or other non-code resources
- Nonliteral dynamic imports
- URL, node:, and package-import-map specifiers
- Root-relative browser paths
- Package imports and package subpaths by default
- require() calls

Package subpaths can be enabled with --include-package-subpaths. This option
may also match project aliases shaped like package subpaths, so review its
output before writing.

## Supported source files

The scanner reads:

- .ts and .tsx
- .js and .jsx
- .mts and .cts
- .mjs and .cjs

Only .ts, .tsx, .js, and .jsx suffixes are removed from module specifiers.

## Development

    npm install
    npm run typecheck
    npm test
    npm run check
    npm pack --dry-run

The project uses TypeScript, Vitest, es-module-lexer, and chokidar. Build
output is generated in dist and is not committed.

## License

MIT

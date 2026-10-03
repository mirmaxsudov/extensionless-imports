import {randomUUID} from "node:crypto";
import {
    chmod,
    lstat,
    readFile,
    readdir,
    rename,
    unlink,
    writeFile,
} from "node:fs/promises";
import {
    basename,
    dirname,
    extname,
    join,
    relative,
    resolve,
} from "node:path";
import {init, parse} from "es-module-lexer";
import {minimatch} from "minimatch";

import type {
    FindFilesOptions,
    ProcessFileOptions,
    ProcessResult,
    StripOptions,
} from "./types.js";

export type {
    FindFilesOptions,
    ProcessFileOptions,
    ProcessResult,
    StripOptions,
} from "./types.js";

const REMOVABLE_EXTENSION = /\.(?:tsx?|jsx?)(?=[?#]|$)/i;

export const DEFAULT_SOURCE_EXTENSIONS: readonly string[] = Object.freeze([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mts",
    ".cts",
    ".mjs",
    ".cjs",
]);
const DEFAULT_IGNORED_DIRECTORIES = new Set([
    ".git",
    "node_modules",
    "dist",
    "coverage",
]);
const URI_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

await init();

interface TextEdit {
    start: number;
    end: number;
    value: string;
}

interface TransformResult {
    code: string;
    replacements: number;
}

/**
 * Remove .ts, .tsx, .js, and .jsx suffixes from eligible module specifiers
 * while preserving every other part of the source text.
 */
export function stripImportExtensions(
    source: string,
    options: StripOptions = {},
): string {
    return transformSource(source, options).code;
}

/**
 * Inspect or rewrite one source file.
 *
 * Preview is the default. Pass write: true to persist changes. The check and
 * write options are mutually exclusive.
 */
export async function processFile(
    filePath: string,
    options: ProcessFileOptions = {},
): Promise<ProcessResult> {
    if (options.check && options.write) {
        throw new TypeError("check and write cannot both be enabled");
    }

    const absolutePath = resolve(filePath);
    const source = await readFile(absolutePath, "utf8");
    const transformed = transformSource(source, options);
    const changed = transformed.code !== source;
    const written = changed && options.write === true;

    if (written) {
        await atomicWrite(absolutePath, transformed.code);
    }

    return {
        path: absolutePath,
        changed,
        replacements: transformed.replacements,
        written,
    };
}

/**
 * Find supported JavaScript and TypeScript source files below a file or
 * directory. Directory symlinks are intentionally not followed.
 */
export async function findSourceFiles(
    inputPath: string,
    options: FindFilesOptions = {},
): Promise<string[]> {
    const absolutePath = resolve(inputPath);
    const baseDirectory = resolve(options.baseDirectory ?? process.cwd());
    const ignoredDirectories = new Set(
        [
            ...DEFAULT_IGNORED_DIRECTORIES,
            ...(options.ignoredDirectories ?? []),
        ].map((name) => name.toLowerCase()),
    );
    const ignorePatterns = options.ignorePatterns ?? [];
    const sourceExtensions = normalizeExtensions(
        options.extensions ?? DEFAULT_SOURCE_EXTENSIONS,
    );
    const files: string[] = [];

    await collectSourceFiles(
        absolutePath,
        baseDirectory,
        ignoredDirectories,
        ignorePatterns,
        sourceExtensions,
        files,
    );
    return files.sort((left, right) => left.localeCompare(right));
}

function transformSource(
    source: string,
    options: StripOptions,
): TransformResult {
    if (typeof source !== "string")
        throw new TypeError("source must be a string");

    const [parsedImports] = parse(source);
    const imports = [...parsedImports];
    const normalizedSource = normalizeTypeOnlyExports(source);

    if (normalizedSource !== source) {
        const [normalizedImports] = parse(normalizedSource);
        const knownRanges = new Set(
            imports.map(({start, end}) => `${start}:${end}`),
        );

        for (const imported of normalizedImports) {
            const range = `${imported.start}:${imported.end}`;
            if (!knownRanges.has(range)) imports.push(imported);
        }
    }
    const edits: TextEdit[] = [];

    for (const imported of imports) {
        const specifier = imported.specifier;
        if (typeof specifier !== "string" || specifier.length === 0) continue;
        if (imported.type === "dynamic" && imported.glob) continue;
        if (!REMOVABLE_EXTENSION.test(specifier)) continue;
        if (!shouldTransformSpecifier(specifier, options)) continue;

        const rawRange = source.slice(imported.start, imported.end);
        const offset = rawRange.indexOf(specifier);
        if (offset < 0) continue;

        const start = imported.start + offset;
        edits.push({
            start,
            end: start + specifier.length,
            value: specifier.replace(REMOVABLE_EXTENSION, ""),
        });
    }

    return {
        code: applyEdits(source, edits),
        replacements: edits.length,
    };
}

function shouldTransformSpecifier(
    specifier: string,
    options: StripOptions,
): boolean {
    if (
        isRelativeSpecifier(specifier) ||
        isProjectAliasSpecifier(specifier)
    ) {
        return true;
    }

    return (
        options.includePackageSubpaths === true && isPackageSubpath(specifier)
    );
}

function isRelativeSpecifier(specifier: string): boolean {
    return specifier.startsWith("./") || specifier.startsWith("../");
}

function isProjectAliasSpecifier(specifier: string): boolean {
    return specifier.startsWith("@/") || specifier.startsWith("~/");
}

function isPackageSubpath(specifier: string): boolean {
    if (
        specifier.startsWith("/") ||
        specifier.charCodeAt(0) === 92 ||
        specifier.startsWith("#") ||
        URI_SCHEME.test(specifier)
    ) {
        return false;
    }

    const path = specifier.split(/[?#]/, 1)[0];
    if (!path) return false;

    const segments = path.split("/");
    return path.startsWith("@") ? segments.length >= 3 : segments.length >= 2;
}

function normalizeTypeOnlyExports(source: string): string {
    return source.replace(/\bexport(\s+)type\b/g, (_match, whitespace: string) => {
        return `export${whitespace}${" ".repeat("type".length)}`;
    });
}

function applyEdits(source: string, edits: TextEdit[]): string {
    let output = source;

    for (const edit of edits.sort((left, right) => right.start - left.start)) {
        output =
            output.slice(0, edit.start) + edit.value + output.slice(edit.end);
    }

    return output;
}

async function collectSourceFiles(
    currentPath: string,
    baseDirectory: string,
    ignoredDirectories: ReadonlySet<string>,
    ignorePatterns: readonly string[],
    sourceExtensions: ReadonlySet<string>,
    files: string[],
): Promise<void> {
    const metadata = await lstat(currentPath);
    if (metadata.isSymbolicLink()) return;
    if (
        isPathIgnored(
            currentPath,
            metadata.isDirectory(),
            baseDirectory,
            ignorePatterns,
        )
    ) {
        return;
    }

    if (metadata.isFile()) {
        if (sourceExtensions.has(extname(currentPath).toLowerCase())) {
            files.push(currentPath);
        }
        return;
    }

    if (!metadata.isDirectory()) return;

    const entries = await readdir(currentPath, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
        if (
            entry.isDirectory() &&
            ignoredDirectories.has(entry.name.toLowerCase())
        ) {
            continue;
        }

        if (entry.isSymbolicLink()) continue;
        await collectSourceFiles(
            join(currentPath, entry.name),
            baseDirectory,
            ignoredDirectories,
            ignorePatterns,
            sourceExtensions,
            files,
        );
    }
}

function normalizeExtensions(extensions: readonly string[]): Set<string> {
    if (extensions.length === 0) {
        throw new TypeError("at least one source extension is required");
    }

    const normalized = new Set<string>();

    for (const extension of extensions) {
        const value = extension.trim().toLowerCase();
        const withoutDot = value.startsWith(".") ? value.slice(1) : value;

        if (!/^[a-z0-9]+$/i.test(withoutDot)) {
            throw new TypeError("invalid source extension: " + extension);
        }

        normalized.add("." + withoutDot);
    }

    return normalized;
}

/**
 * Test a path against the same cwd-relative glob rules used by file discovery.
 */
export function isPathIgnored(
    filePath: string,
    isDirectory: boolean,
    baseDirectory: string,
    patterns: readonly string[],
): boolean {
    if (patterns.length === 0) return false;

    const relativePath = relative(baseDirectory, filePath)
        .split("\\")
        .join("/");
    const candidate = relativePath.length === 0 ? "." : relativePath;
    const candidates = isDirectory ? [candidate, candidate + "/"] : [candidate];

    return patterns.some((pattern) => {
        if (pattern.length === 0) {
            throw new TypeError("ignore patterns cannot be empty");
        }

        return candidates.some((path) =>
            minimatch(path, pattern, {
                dot: true,
                nocase: process.platform === "win32",
                nonegate: true,
            }),
        );
    });
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
    const metadata = await lstat(filePath);
    const temporaryPath = join(
        dirname(filePath),
        "." +
        basename(filePath) +
        "." +
        process.pid +
        "." +
        randomUUID() +
        ".tmp",
    );

    try {
        await writeFile(temporaryPath, contents, {
            encoding: "utf8",
            mode: metadata.mode,
        });
        await chmod(temporaryPath, metadata.mode);
        await rename(temporaryPath, filePath);
    } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
    }
}

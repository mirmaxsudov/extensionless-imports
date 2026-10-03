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
import {minimatch} from "minimatch";

import {addFileToParseError, syntaxFromPath} from "./parser.js";
import {transformSource, type TransformResult} from "./transform.js";
import type {
    FindFilesOptions,
    ProcessFileOptions,
    ProcessResult,
} from "./types.js";

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
    let transformed: TransformResult;

    try {
        transformed = transformSource(
            source,
            options,
            options.syntax ?? syntaxFromPath(absolutePath),
        );
    } catch (error) {
        throw addFileToParseError(error, absolutePath);
    }

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

/** Test a path against the same cwd-relative glob rules used by discovery. */
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

#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import {isAbsolute, relative, resolve} from "node:path";
import {watch as watchPaths, type FSWatcher} from "chokidar";

import {
    DEFAULT_SOURCE_EXTENSIONS,
    findSourceFiles,
    isPathIgnored,
    processFile,
} from "./index.js";
import type {FindFilesOptions} from "./types.js";

type RunMode = "preview" | "write" | "check";

interface CliOptions {
    mode: RunMode;
    includePackageSubpaths: boolean;
    ignorePatterns: string[];
    extensions: string[] | undefined;
    verbose: boolean;
    watch: boolean;
    paths: string[];
    help: boolean;
    version: boolean;
}

try {
    const options = parseArguments(process.argv.slice(2));

    if (options.help) {
        printHelp();
    } else if (options.version) {
        console.log(await readVersion());
    } else {
        await run(options);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
}

async function run(options: CliOptions): Promise<void> {
    const inputPaths = (options.paths.length > 0 ? options.paths : ["."]).map(
        (inputPath) => resolve(inputPath),
    );
    const fileSet = new Set<string>();
    const findOptions: FindFilesOptions = {
        baseDirectory: process.cwd(),
        ignorePatterns: options.ignorePatterns,
    };

    if (options.extensions !== undefined) {
        findOptions.extensions = options.extensions;
    }

    if (options.verbose) {
        console.log("mode: " + options.mode);
        console.log(
            "package subpaths: " +
            (options.includePackageSubpaths ? "included" : "excluded"),
        );
        console.log(
            "extensions: " +
            (options.extensions ?? DEFAULT_SOURCE_EXTENSIONS).join(", "),
        );
        console.log(
            "ignore patterns: " +
            (options.ignorePatterns.length > 0
                ? options.ignorePatterns.join(", ")
                : "none"),
        );
        console.log("watch: " + (options.watch ? "enabled" : "disabled"));
    }

    for (const inputPath of inputPaths) {
        if (options.verbose) {
            console.log("scanning " + displayPath(inputPath));
        }

        for (const filePath of await findSourceFiles(inputPath, findOptions)) {
            fileSet.add(filePath);
        }
    }

    const files = [...fileSet].sort((left, right) =>
        left.localeCompare(right),
    );
    let changedCount = 0;

    if (options.verbose) {
        const fileLabel = files.length === 1 ? "file" : "files";
        console.log("found " + files.length + " source " + fileLabel);
    }

    for (const filePath of files) {
        const result = await processFile(filePath, {
            check: options.mode === "check",
            write: options.mode === "write",
            includePackageSubpaths: options.includePackageSubpaths,
        });

        if (!result.changed) {
            if (options.verbose) {
                console.log("unchanged " + displayPath(result.path));
            }
            continue;
        }
        changedCount += 1;

        const action = options.mode === "write" ? "updated" : "would update";
        const details = options.verbose
            ? " (" +
            result.replacements +
            " " +
            (result.replacements === 1 ? "replacement" : "replacements") +
            ")"
            : "";
        console.log(action + " " + displayPath(result.path) + details);
    }

    if (changedCount > 0) console.log();
    console.log(summary(options.mode, changedCount, files.length));

    if (options.mode === "check" && changedCount > 0) {
        process.exitCode = 1;
    }

    if (options.watch) {
        await startWatcher(inputPaths, findOptions, options);
    }
}

function parseArguments(args: string[]): CliOptions {
    let mode: RunMode = "preview";
    let modeWasSet = false;
    let includePackageSubpaths = false;
    const ignorePatterns: string[] = [];
    let extensions: string[] | undefined;
    let verbose = false;
    let watch = false;
    let help = false;
    let version = false;
    let positionalOnly = false;
    const paths: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === undefined) continue;

        if (positionalOnly) {
            paths.push(argument);
            continue;
        }

        if (argument === "--") {
            positionalOnly = true;
            continue;
        }

        if (argument === "--write") {
            if (modeWasSet && mode !== "write") {
                throw new TypeError("--write and --check cannot be used together");
            }
            mode = "write";
            modeWasSet = true;
            continue;
        }

        if (argument === "--check") {
            if (modeWasSet && mode !== "check") {
                throw new TypeError("--write and --check cannot be used together");
            }
            mode = "check";
            modeWasSet = true;
            continue;
        }

        if (argument === "--include-package-subpaths") {
            includePackageSubpaths = true;
            continue;
        }

        if (argument === "--ignore") {
            ignorePatterns.push(readOptionValue(args, index, "--ignore"));
            index += 1;
            continue;
        }

        if (argument.startsWith("--ignore=")) {
            const pattern = argument.slice("--ignore=".length);
            if (pattern.length === 0) {
                throw new TypeError("--ignore requires a pattern");
            }
            ignorePatterns.push(pattern);
            continue;
        }

        if (argument === "--extensions") {
            const value = readOptionValue(args, index, "--extensions");
            extensions = [
                ...(extensions ?? []),
                ...parseExtensionList(value),
            ];
            index += 1;
            continue;
        }

        if (argument.startsWith("--extensions=")) {
            extensions = [
                ...(extensions ?? []),
                ...parseExtensionList(
                    argument.slice("--extensions=".length),
                ),
            ];
            continue;
        }

        if (argument === "--verbose") {
            verbose = true;
            continue;
        }

        if (argument === "--watch") {
            watch = true;
            continue;
        }

        if (argument === "--help" || argument === "-h") {
            help = true;
            continue;
        }

        if (argument === "--version" || argument === "-v") {
            version = true;
            continue;
        }

        if (argument.startsWith("-")) {
            throw new TypeError("unknown option: " + argument);
        }

        paths.push(argument);
    }

    if (watch && mode !== "write") {
        throw new TypeError("--watch requires --write");
    }

    return {
        mode,
        includePackageSubpaths,
        ignorePatterns,
        extensions,
        verbose,
        watch,
        paths,
        help,
        version,
    };
}

async function startWatcher(
    inputPaths: string[],
    findOptions: FindFilesOptions,
    options: CliOptions,
): Promise<void> {
    const watcher = watchPaths(inputPaths, {
        ignoreInitial: true,
        followSymlinks: false,
        atomic: true,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 20,
        },
        ignored: (filePath, stats) =>
            hasDefaultIgnoredDirectory(filePath) ||
            isPathIgnored(
                resolve(filePath),
                stats?.isDirectory() === true,
                process.cwd(),
                options.ignorePatterns,
            ),
    });

    const pending = new Map<string, Promise<void>>();

    const enqueue = (filePath: string): void => {
        const absolutePath = resolve(filePath);
        const previous = pending.get(absolutePath) ?? Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(() =>
                processWatchedFile(absolutePath, findOptions, options),
            );

        pending.set(absolutePath, current);
        void current.finally(() => {
            if (pending.get(absolutePath) === current) {
                pending.delete(absolutePath);
            }
        });
    };

    watcher.on("add", enqueue);
    watcher.on("change", enqueue);
    await waitForWatcherReady(watcher);

    console.log("watching for changes (press Ctrl+C to stop)");
    await waitForWatcherShutdown(watcher, pending);
}

async function processWatchedFile(
    filePath: string,
    findOptions: FindFilesOptions,
    options: CliOptions,
): Promise<void> {
    try {
        const files = await findSourceFiles(filePath, findOptions);
        if (files.length === 0) return;

        const result = await processFile(filePath, {
            write: true,
            includePackageSubpaths: options.includePackageSubpaths,
        });

        if (result.changed) {
            const details = options.verbose
                ? " (" +
                result.replacements +
                " " +
                (result.replacements === 1
                    ? "replacement"
                    : "replacements") +
                ")"
                : "";
            console.log("updated " + displayPath(result.path) + details);
        } else if (options.verbose) {
            console.log("unchanged " + displayPath(result.path));
        }
    } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return;

        console.error(
            "failed " +
            displayPath(filePath) +
            ": " +
            (error instanceof Error ? error.message : String(error)),
        );
        process.exitCode = 2;
    }
}

function waitForWatcherReady(watcher: FSWatcher): Promise<void> {
    return new Promise((resolveReady, rejectReady) => {
        const onReady = (): void => {
            watcher.off("error", onError);
            resolveReady();
        };
        const onError = (error: unknown): void => {
            watcher.off("ready", onReady);
            rejectReady(error);
        };

        watcher.once("ready", onReady);
        watcher.once("error", onError);
    });
}

function waitForWatcherShutdown(
    watcher: FSWatcher,
    pending: ReadonlyMap<string, Promise<void>>,
): Promise<void> {
    return new Promise((resolveShutdown) => {
        let closing = false;

        const cleanup = (): void => {
            process.off("SIGINT", stop);
            process.off("SIGTERM", stop);
        };

        const stop = (): void => {
            if (closing) return;
            closing = true;

            void (async () => {
                await watcher.close();
                await Promise.allSettled([...pending.values()]);
                cleanup();
                resolveShutdown();
            })();
        };

        const onError = (error: unknown): void => {
            console.error(
                "watcher error: " +
                (error instanceof Error ? error.message : String(error)),
            );
            process.exitCode = 2;
            stop();
        };

        watcher.on("error", onError);
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
    });
}

function hasDefaultIgnoredDirectory(filePath: string): boolean {
    const ignored = new Set([".git", "node_modules", "dist", "coverage"]);
    return relative(process.cwd(), resolve(filePath))
        .split(/[\\/]+/)
        .some((segment) => ignored.has(segment.toLowerCase()));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}

function readOptionValue(
    args: readonly string[],
    optionIndex: number,
    optionName: string,
): string {
    const value = args[optionIndex + 1];
    if (value === undefined || value.startsWith("-")) {
        throw new TypeError(optionName + " requires a value");
    }
    return value;
}

function parseExtensionList(value: string): string[] {
    const extensions = value.split(",").map((extension) => extension.trim());
    if (
        extensions.length === 0 ||
        extensions.some((extension) => extension.length === 0)
    ) {
        throw new TypeError("--extensions requires a comma-separated list");
    }

    for (const extension of extensions) {
        const withoutDot = extension.startsWith(".")
            ? extension.slice(1)
            : extension;
        if (!/^[a-z0-9]+$/i.test(withoutDot)) {
            throw new TypeError("invalid source extension: " + extension);
        }
    }

    return extensions;
}

function summary(mode: RunMode, changed: number, total: number): string {
    const fileLabel = total === 1 ? "file" : "files";

    if (mode === "write") {
        return changed + " of " + total + " " + fileLabel + " updated";
    }

    if (mode === "check") {
        const changedLabel = changed === 1 ? "file needs" : "files need";
        return changed + " of " + total + " " + changedLabel + " changes";
    }

    return changed + " of " + total + " " + fileLabel + " would change";
}

function displayPath(filePath: string): string {
    const pathFromCwd = relative(process.cwd(), filePath);
    if (
        pathFromCwd.length > 0 &&
        !pathFromCwd.startsWith("..") &&
        !isAbsolute(pathFromCwd)
    ) {
        return pathFromCwd;
    }

    return filePath;
}

async function readVersion(): Promise<string> {
    const packageJsonUrl = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8")) as {
        version?: unknown;
    };

    if (typeof packageJson.version !== "string") {
        throw new TypeError("package.json does not contain a valid version");
    }

    return packageJson.version;
}

function printHelp(): void {
    console.log(
        [
            "Usage: extensionless-imports [options] [files or directories...]",
            "",
            "Remove .ts, .tsx, .js, and .jsx suffixes from module specifiers.",
            "Preview mode is used when neither --write nor --check is provided.",
            "",
            "Options:",
            "  --write                      Update files in place",
            "  --check                      Exit with code 1 when changes are needed",
            "  --include-package-subpaths   Also rewrite package subpaths",
            "  --ignore <pattern>           Ignore a glob pattern (repeatable)",
            "  --extensions <list>          Scan comma-separated extensions",
            "  --verbose                    Show discovery and processing details",
            "  --watch                      Rewrite files automatically after save",
            "  -h, --help                   Show this help",
            "  -v, --version                Show the package version",
        ].join("\n"),
    );
}

import {relative, resolve} from "node:path";
import {watch as watchPaths, type FSWatcher} from "chokidar";

import {findSourceFiles, isPathIgnored, processFile} from "../index.js";
import type {FindFilesOptions} from "../types.js";
import type {CliOptions} from "./options.js";
import {displayPath, reportFileFailure} from "./output.js";

export async function startWatcher(
    inputPaths: string[],
    findOptions: FindFilesOptions,
    options: CliOptions,
    failures: Set<string>,
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
                processWatchedFile(
                    absolutePath,
                    findOptions,
                    options,
                    failures,
                ),
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
    failures: Set<string>,
): Promise<void> {
    try {
        const files = await findSourceFiles(filePath, findOptions);
        if (files.length === 0) return;

        const result = await processFile(filePath, {
            write: true,
            includePackageSubpaths: options.includePackageSubpaths,
        });

        failures.delete(resolve(filePath));
        process.exitCode = failures.size > 0 ? 2 : 0;

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

        failures.add(resolve(filePath));
        reportFileFailure(filePath, error);
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

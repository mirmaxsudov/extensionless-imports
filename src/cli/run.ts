import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

import {
    DEFAULT_SOURCE_EXTENSIONS,
    findSourceFiles,
    processFile,
} from "../index.js";
import type {FindFilesOptions} from "../types.js";
import type {CliOptions} from "./options.js";
import {displayPath, reportFileFailure, summary} from "./output.js";
import {startWatcher} from "./watch.js";

export async function run(options: CliOptions): Promise<void> {
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

    if (options.verbose) printConfiguration(options);

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
    const watchFailures = new Set<string>();

    if (options.verbose) {
        const fileLabel = files.length === 1 ? "file" : "files";
        console.log("found " + files.length + " source " + fileLabel);
    }

    for (const filePath of files) {
        let result: Awaited<ReturnType<typeof processFile>>;

        try {
            result = await processFile(filePath, {
                check: options.mode === "check",
                write: options.mode === "write",
                includePackageSubpaths: options.includePackageSubpaths,
            });
        } catch (error) {
            if (!options.watch) throw error;

            watchFailures.add(resolve(filePath));
            reportFileFailure(filePath, error);
            process.exitCode = 2;
            continue;
        }

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
        await startWatcher(inputPaths, findOptions, options, watchFailures);
    }
}

export async function readVersion(): Promise<string> {
    const packageJsonUrl = new URL("../../package.json", import.meta.url);
    const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8")) as {
        version?: unknown;
    };

    if (typeof packageJson.version !== "string") {
        throw new TypeError("package.json does not contain a valid version");
    }

    return packageJson.version;
}

function printConfiguration(options: CliOptions): void {
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

import {isAbsolute, relative} from "node:path";

import type {RunMode} from "./options.js";

export function summary(
    mode: RunMode,
    changed: number,
    total: number,
): string {
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

export function displayPath(filePath: string): string {
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

export function reportFileFailure(filePath: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Failed to parse ")) {
        console.error(message);
        return;
    }

    console.error("failed " + displayPath(filePath) + ": " + message);
}

export function printHelp(): void {
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

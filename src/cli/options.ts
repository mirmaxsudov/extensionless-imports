export type RunMode = "preview" | "write" | "check";

export interface CliOptions {
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

export function parseArguments(args: string[]): CliOptions {
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
                ...parseExtensionList(argument.slice("--extensions=".length)),
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

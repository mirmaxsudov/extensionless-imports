export interface StripOptions {
    /**
     * Also rewrite package subpaths such as some-package/helper.js.
     *
     * Package subpaths are unchanged by default because their extensions can be
     * part of the package's public API.
     */
    includePackageSubpaths?: boolean;
}

export interface ProcessFileOptions extends StripOptions {
    /** Report changes without writing them. */
    check?: boolean;

    /** Persist transformed source code to disk. */
    write?: boolean;
}

export interface ProcessResult {
    path: string;
    changed: boolean;
    replacements: number;
    written: boolean;
}

export interface FindFilesOptions {
    /** Additional directory names to ignore during recursive discovery. */
    ignoredDirectories?: readonly string[];

    /**
     * Glob patterns matched against forward-slash paths relative to
     * baseDirectory.
     */
    ignorePatterns?: readonly string[];

    /**
     * Source file extensions to scan. Values may include or omit the leading
     * dot. Defaults to the JavaScript and TypeScript extension set exported as
     * DEFAULT_SOURCE_EXTENSIONS.
     */
    extensions?: readonly string[];

    /** Base directory used to resolve ignore patterns. Defaults to cwd. */
    baseDirectory?: string;
}

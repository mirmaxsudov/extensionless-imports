import {collectModuleSpecifiers} from "./parser.js";
import type {SourceSyntax, StripOptions} from "./types.js";

const REMOVABLE_EXTENSION = /\.(?:tsx?|jsx?)(?=[?#]|$)/i;
const URI_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

interface TextEdit {
    start: number;
    end: number;
    value: string;
}

export interface TransformResult {
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
    return transformSource(source, options, options.syntax ?? "auto").code;
}

export function transformSource(
    source: string,
    options: StripOptions,
    syntax: SourceSyntax,
): TransformResult {
    if (typeof source !== "string") {
        throw new TypeError("source must be a string");
    }

    const imports = collectModuleSpecifiers(source, syntax);
    const edits: TextEdit[] = [];

    for (const imported of imports) {
        const specifier = imported.value;
        if (specifier.length === 0) continue;
        if (!REMOVABLE_EXTENSION.test(specifier)) continue;
        if (!shouldTransformSpecifier(specifier, options)) continue;

        const rawSpecifier = source.slice(imported.start, imported.end);
        if (rawSpecifier !== specifier) continue;

        edits.push({
            start: imported.start,
            end: imported.end,
            value: rawSpecifier.replace(REMOVABLE_EXTENSION, ""),
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

function applyEdits(source: string, edits: TextEdit[]): string {
    let output = source;

    for (const edit of edits.sort((left, right) => right.start - left.start)) {
        output =
            output.slice(0, edit.start) + edit.value + output.slice(edit.end);
    }

    return output;
}

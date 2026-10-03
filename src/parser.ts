import {extname} from "node:path";
import {parse, type ParserPlugin} from "@babel/parser";

import type {SourceSyntax} from "./types.js";

export interface ModuleSpecifier {
    start: number;
    end: number;
    value: string;
}

interface AstNode {
    type: string;
    start?: number | null;
    end?: number | null;

    [key: string]: unknown;
}

export function collectModuleSpecifiers(
    source: string,
    syntax: SourceSyntax,
): ModuleSpecifier[] {
    const ast = parseSource(source, syntax) as unknown as AstNode;
    const specifiers: ModuleSpecifier[] = [];
    const knownRanges = new Set<string>();

    const addLiteral = (value: unknown, allowTemplate = false): void => {
        if (!isAstNode(value)) return;

        if (value.type === "StringLiteral") {
            addSpecifier(value, value.value);
            return;
        }

        if (allowTemplate && value.type === "TemplateLiteral") {
            const expressions = value.expressions;
            const quasis = value.quasis;
            if (
                Array.isArray(expressions) &&
                expressions.length === 0 &&
                Array.isArray(quasis) &&
                quasis.length === 1 &&
                isAstNode(quasis[0])
            ) {
                const templateValue = quasis[0].value;
                if (isRecord(templateValue)) {
                    addSpecifier(value, templateValue.cooked);
                }
            }
        }
    };

    const addSpecifier = (node: AstNode, value: unknown): void => {
        if (
            typeof node.start !== "number" ||
            typeof node.end !== "number" ||
            typeof value !== "string"
        ) {
            return;
        }

        const start = node.start + 1;
        const end = node.end - 1;
        const range = `${start}:${end}`;
        if (start > end || knownRanges.has(range)) return;

        knownRanges.add(range);
        specifiers.push({start, end, value});
    };

    const visit = (node: AstNode): void => {
        switch (node.type) {
            case "ImportDeclaration":
            case "ExportNamedDeclaration":
            case "ExportAllDeclaration":
                addLiteral(node.source);
                break;
            case "ImportExpression":
                addLiteral(node.source, true);
                break;
            case "CallExpression":
                if (isAstNode(node.callee) && node.callee.type === "Import") {
                    const argumentsList = node.arguments;
                    if (Array.isArray(argumentsList)) {
                        addLiteral(argumentsList[0], true);
                    }
                }
                break;
            case "TSImportType":
                addLiteral(node.argument);
                break;
            case "TSExternalModuleReference":
                addLiteral(node.expression);
                break;
        }

        for (const [key, value] of Object.entries(node)) {
            if (
                key === "loc" ||
                key === "extra" ||
                key === "comments" ||
                key === "errors" ||
                key === "tokens"
            ) {
                continue;
            }

            if (isAstNode(value)) {
                visit(value);
            } else if (Array.isArray(value)) {
                for (const child of value) {
                    if (isAstNode(child)) visit(child);
                }
            }
        }
    };

    visit(ast);
    return specifiers;
}

export function syntaxFromPath(filePath: string): SourceSyntax {
    switch (extname(filePath).toLowerCase()) {
        case ".jsx":
            return "jsx";
        case ".ts":
        case ".mts":
        case ".cts":
            return "ts";
        case ".tsx":
            return "tsx";
        case ".js":
        case ".mjs":
        case ".cjs":
            return "js";
        default:
            return "auto";
    }
}

export function addFileToParseError(error: unknown, filePath: string): unknown {
    if (!isRecord(error) || error.code !== "BABEL_PARSER_SYNTAX_ERROR") {
        return error;
    }

    const location = error.loc;
    const suffix =
        isRecord(location) &&
        typeof location.line === "number" &&
        typeof location.column === "number"
            ? `:${location.line}:${location.column + 1}`
            : "";
    const rawMessage =
        typeof error.message === "string" ? error.message : "Parse error";
    const message = rawMessage.replace(/\s+\(\d+:\d+\)$/, "");

    return new SyntaxError(`Failed to parse ${filePath}${suffix}: ${message}`);
}

function parseSource(source: string, syntax: SourceSyntax): unknown {
    if (syntax !== "auto") return parseWithSyntax(source, syntax);

    let lastError: unknown;
    for (const candidate of ["js", "ts", "jsx", "tsx"] as const) {
        try {
            return parseWithSyntax(source, candidate);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
}

function parseWithSyntax(source: string, syntax: Exclude<SourceSyntax, "auto">) {
    const plugins: ParserPlugin[] = ["decorators-legacy"];
    if (syntax === "ts" || syntax === "tsx") plugins.push("typescript");
    if (syntax === "jsx" || syntax === "tsx") plugins.push("jsx");

    return parse(source, {
        sourceType: "unambiguous",
        plugins,
    });
}

function isAstNode(value: unknown): value is AstNode {
    return isRecord(value) && typeof value.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

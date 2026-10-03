import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("dynamic import", () => {
    it("removes the source extension from a string-literal import", () => {
        expect(stripImportExtensions('const page = await import("./Page.jsx");'))
            .toBe('const page = await import("./Page");');
    });

    it("leaves a nonliteral import unchanged", () => {
        const source = "const page = await import(modulePath);";

        expect(stripImportExtensions(source)).toBe(source);
    });
});

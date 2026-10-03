import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("relative import", () => {
    it("removes extensions from parent and current-directory imports", () => {
        const source = [
            'import parent from "../parent.js";',
            'import sibling from "./sibling.ts";',
        ].join("\n");

        expect(stripImportExtensions(source)).toBe([
            'import parent from "../parent";',
            'import sibling from "./sibling";',
        ].join("\n"));
    });
});

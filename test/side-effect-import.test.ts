import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("side-effect import", () => {
    it("removes the source extension", () => {
        expect(stripImportExtensions('import "./setup.js";'))
            .toBe('import "./setup";');
    });
});

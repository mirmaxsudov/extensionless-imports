import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("named import", () => {
    it("removes the source extension", () => {
        expect(stripImportExtensions('import {readFile} from "./filesystem.js";'))
            .toBe('import {readFile} from "./filesystem";');
    });
});

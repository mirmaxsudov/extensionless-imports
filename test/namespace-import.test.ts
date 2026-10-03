import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("namespace import", () => {
    it("removes the source extension", () => {
        expect(
            stripImportExtensions('import * as utilities from "./utilities.js";'),
        ).toBe('import * as utilities from "./utilities";');
    });
});

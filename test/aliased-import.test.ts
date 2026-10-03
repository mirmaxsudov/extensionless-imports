import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("aliased import", () => {
    it("removes the source extension", () => {
        expect(
            stripImportExtensions('import {formatDate as format} from "./date.ts";'),
        ).toBe('import {formatDate as format} from "./date";');
    });
});

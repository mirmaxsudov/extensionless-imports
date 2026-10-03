import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("default import", () => {
    it("removes the source extension", () => {
        expect(stripImportExtensions('import Button from "./Button.tsx";'))
            .toBe('import Button from "./Button";');
    });
});

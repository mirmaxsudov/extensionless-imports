import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("barrel import", () => {
    it("removes the extension from an explicit barrel-file import", () => {
        expect(stripImportExtensions(
            'import {Button, Input} from "./components/index.ts";',
        )).toBe('import {Button, Input} from "./components/index";');
    });
});

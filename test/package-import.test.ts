import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("package import", () => {
    it("keeps package subpaths unchanged by default", () => {
        const source = 'import helper from "some-package/helper.js";';

        expect(stripImportExtensions(source)).toBe(source);
    });

    it("removes package subpath extensions when explicitly enabled", () => {
        expect(stripImportExtensions(
            'import helper from "some-package/helper.js";',
            {includePackageSubpaths: true},
        )).toBe('import helper from "some-package/helper";');
    });
});

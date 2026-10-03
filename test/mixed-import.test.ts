import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("mixed import", () => {
    it("removes the source extension", () => {
        expect(
            stripImportExtensions('import React, {useMemo} from "./react.ts";'),
        ).toBe('import React, {useMemo} from "./react";');
    });
});

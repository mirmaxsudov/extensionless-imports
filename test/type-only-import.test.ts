import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("type-only import", () => {
    it("removes the source extension", () => {
        expect(
            stripImportExtensions('import type {User} from "./User.ts";'),
        ).toBe('import type {User} from "./User";');
    });
});

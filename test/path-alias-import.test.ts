import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("path-alias import", () => {
    it("removes extensions from conventional at and tilde aliases", () => {
        const source = [
            'import Button from "@/components/Button.tsx";',
            'import type {User} from "~/types/User.ts";',
        ].join("\n");

        expect(stripImportExtensions(source)).toBe([
            'import Button from "@/components/Button";',
            'import type {User} from "~/types/User";',
        ].join("\n"));
    });
});

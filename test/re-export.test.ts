import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("re-export", () => {
    it("removes extensions from named and wildcard re-exports", () => {
        const source = [
            'export {Button} from "./Button.tsx";',
            'export * from "./utilities.js";',
        ].join("\n");

        expect(stripImportExtensions(source)).toBe([
            'export {Button} from "./Button";',
            'export * from "./utilities";',
        ].join("\n"));
    });

    it("removes the extension from a type-only re-export", () => {
        expect(stripImportExtensions('export type {User} from "./User.ts";'))
            .toBe('export type {User} from "./User";');
    });

    it("does not transform type-only export text in strings or comments", () => {
        const source = 'const example = `export type {User} from "./User.ts";`;\n' +
            '// export type {Account} from "./Account.ts";';

        expect(stripImportExtensions(source)).toBe(source);
    });
});

import {describe, expect, it} from "vitest";

import {stripImportExtensions} from "../src/index.ts";

describe("asset import", () => {
    it("removes a source extension while preserving an asset query", () => {
        expect(stripImportExtensions('import workerUrl from "./worker.ts?worker&url";'))
            .toBe('import workerUrl from "./worker?worker&url";');
    });

    it("preserves non-code asset extensions", () => {
        const source = [
            'import styles from "./styles.css";',
            'import logo from "./logo.svg";',
            'import data from "./data.json";',
        ].join("\n");

        expect(stripImportExtensions(source)).toBe(source);
    });
});

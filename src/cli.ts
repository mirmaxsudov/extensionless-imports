#!/usr/bin/env node

import {parseArguments} from "./cli/options.js";
import {printHelp} from "./cli/output.js";
import {readVersion, run} from "./cli/run.js";

try {
    const options = parseArguments(process.argv.slice(2));

    if (options.help) {
        printHelp();
    } else if (options.version) {
        console.log(await readVersion());
    } else {
        await run(options);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
}
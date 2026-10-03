import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  findSourceFiles,
  processFile,
  stripImportExtensions,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];
const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("stripImportExtensions", () => {
  it("rewrites static, side-effect, type-only, and re-export specifiers", () => {
    const source = [
      'import value from "./value.ts";',
      "import type { User } from '../types/User.tsx';",
      'import "./setup.js";',
      'export { Button } from "./Button.tsx";',
      'export * from "../shared/index.js";',
    ].join("\n");

    expect(stripImportExtensions(source)).toBe(
      [
        'import value from "./value";',
        "import type { User } from '../types/User';",
        'import "./setup";',
        'export { Button } from "./Button";',
        'export * from "../shared/index";',
      ].join("\n"),
    );
  });

  it("rewrites string-literal dynamic imports", () => {
    expect(stripImportExtensions('const page = import("./Page.jsx");')).toBe(
      'const page = import("./Page");',
    );
  });

  it("rewrites conventional project alias imports", () => {
    const source = [
      'import Button from "@/components/Button.tsx";',
      'import type { User } from "~/types/User.ts";',
      'export { api } from "@/services/api.js";',
      'const page = import("~/pages/Home.jsx");',
      'import tool from "@scope/package/tool.ts";',
    ].join("\n");

    expect(stripImportExtensions(source)).toBe(
      [
        'import Button from "@/components/Button";',
        'import type { User } from "~/types/User";',
        'export { api } from "@/services/api";',
        'const page = import("~/pages/Home");',
        'import tool from "@scope/package/tool.ts";',
      ].join("\n"),
    );
  });

  it("rewrites imports in TSX without changing JSX", () => {
    const source = [
      'import { ChatPage } from "@/modules/chat/components/ChatPage.tsx";',
      'import type { RouterContext } from "./RouterContext.ts";',
      "",
      "export const Root = () => (",
      "  <ThemeProvider>",
      "    <button",
      "      onClick={() =>",
      "        toast.add({ title: 'Toast smoke test', type: 'success' })",
      "      }",
      "    >",
      "      Toast smoke test",
      "    </button>",
      "  </ThemeProvider>",
      ");",
    ].join("\n");

    expect(stripImportExtensions(source, { syntax: "tsx" })).toBe(
      source
        .replace("ChatPage.tsx", "ChatPage")
        .replace("RouterContext.ts", "RouterContext"),
    );
  });

  it("handles tagged templates inside JSX", () => {
    const source = [
      "import { LoginForm } from '@/modules/auth/index.ts';",
      "",
      "export const LoginPage = () => (",
      "  <section>",
      "    <h1>{t`Welcome back.`}</h1>",
      "    <p>{t`Your credentials are protected in transit.`}</p>",
      "    <LoginForm />",
      "  </section>",
      ");",
    ].join("\n");

    expect(stripImportExtensions(source)).toBe(
      source.replace("@/modules/auth/index.ts", "@/modules/auth/index"),
    );
  });

  it("auto-detects TypeScript angle-bracket assertions", () => {
    const source = [
      'import value from "./value.ts";',
      "const typed = <string>value;",
    ].join("\n");

    expect(stripImportExtensions(source)).toBe(
      source.replace("./value.ts", "./value"),
    );
  });

  it("preserves query strings, fragments, and line endings", () => {
    const source =
      'import raw from "./file.ts?raw";\r\n' +
      'import preview from "./Component.tsx#preview";\r\n';

    expect(stripImportExtensions(source)).toBe(
      'import raw from "./file?raw";\r\n' +
        'import preview from "./Component#preview";\r\n',
    );
  });

  it("ignores comments, ordinary strings, unsupported assets, and packages", () => {
    const source = [
      'const filename = "./example.ts";',
      '// import fake from "./comment.ts";',
      'import data from "./data.json";',
      'import styles from "./styles.css";',
      'import helper from "some-package/helper.js";',
      'import builtin from "node:fs";',
      'import remote from "https://example.com/module.js";',
      'import root from "/assets/module.js";',
    ].join("\n");

    expect(stripImportExtensions(source)).toBe(source);
  });

  it("ignores nonliteral dynamic imports", () => {
    const source = "const page = import(\`./pages/\${name}.tsx\`);";
    expect(stripImportExtensions(source)).toBe(source);
  });

  it("can rewrite unscoped and scoped package subpaths", () => {
    const source = [
      'import helper from "some-package/helper.js";',
      'import tool from "@scope/package/tool.ts";',
      'import packageRoot from "package.js";',
    ].join("\n");

    expect(
      stripImportExtensions(source, { includePackageSubpaths: true }),
    ).toBe(
      [
        'import helper from "some-package/helper";',
        'import tool from "@scope/package/tool";',
        'import packageRoot from "package.js";',
      ].join("\n"),
    );
  });

  it("rejects non-string input at runtime", () => {
    expect(() => stripImportExtensions(42 as never)).toThrow(TypeError);
  });
});

describe("processFile", () => {
  it("previews, checks, and writes changes explicitly", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "example.ts");
    const original = 'import value from "./value.ts";\n';
    await writeFile(filePath, original, "utf8");

    await expect(processFile(filePath)).resolves.toMatchObject({
      changed: true,
      replacements: 1,
      written: false,
    });
    expect(await readFile(filePath, "utf8")).toBe(original);

    await expect(processFile(filePath, { check: true })).resolves.toMatchObject({
      changed: true,
      replacements: 1,
      written: false,
    });
    expect(await readFile(filePath, "utf8")).toBe(original);

    await expect(processFile(filePath, { write: true })).resolves.toMatchObject({
      changed: true,
      replacements: 1,
      written: true,
    });
    expect(await readFile(filePath, "utf8")).toBe(
      'import value from "./value";\n',
    );

    await expect(processFile(filePath, { write: true })).resolves.toMatchObject({
      changed: false,
      replacements: 0,
      written: false,
    });
  });

  it("rejects conflicting check and write options", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "example.ts");
    await writeFile(filePath, "", "utf8");

    await expect(
      processFile(filePath, { check: true, write: true }),
    ).rejects.toThrow("check and write cannot both be enabled");
  });

  it("includes the source filename in parser errors", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "broken.tsx");
    await writeFile(filePath, "export const Broken = () => <div>;", "utf8");

    await expect(processFile(filePath)).rejects.toThrow(
      `Failed to parse ${filePath}`,
    );
  });
});

describe("findSourceFiles", () => {
  it("finds supported sources and ignores generated directories", async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, "src", "nested"), { recursive: true });
    await mkdir(join(directory, "node_modules", "dependency"), {
      recursive: true,
    });
    await mkdir(join(directory, "generated"), { recursive: true });

    await Promise.all([
      writeFile(join(directory, "src", "index.ts"), "", "utf8"),
      writeFile(join(directory, "src", "nested", "view.tsx"), "", "utf8"),
      writeFile(join(directory, "src", "notes.txt"), "", "utf8"),
      writeFile(
        join(directory, "node_modules", "dependency", "index.js"),
        "",
        "utf8",
      ),
      writeFile(join(directory, "generated", "client.js"), "", "utf8"),
    ]);

    const files = await findSourceFiles(directory, {
      ignoredDirectories: ["generated"],
    });
    const relativeFiles = files.map((file) => relative(directory, file));

    expect(relativeFiles).toEqual([
      join("src", "index.ts"),
      join("src", "nested", "view.tsx"),
    ]);
  });

  it("accepts a supported file and rejects an unsupported file", async () => {
    const directory = await createTemporaryDirectory();
    const sourceFile = join(directory, "index.mts");
    const textFile = join(directory, "notes.txt");
    await writeFile(sourceFile, "", "utf8");
    await writeFile(textFile, "", "utf8");

    await expect(findSourceFiles(sourceFile)).resolves.toEqual([sourceFile]);
    await expect(findSourceFiles(textFile)).resolves.toEqual([]);
  });

  it("filters files with glob patterns and custom extensions", async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, "src", "ignored"), { recursive: true });

    await Promise.all([
      writeFile(join(directory, "src", "index.ts"), "", "utf8"),
      writeFile(join(directory, "src", "component.tsx"), "", "utf8"),
      writeFile(join(directory, "src", "script.js"), "", "utf8"),
      writeFile(join(directory, "src", "ignored", "skip.ts"), "", "utf8"),
    ]);

    const files = await findSourceFiles(directory, {
      baseDirectory: directory,
      ignorePatterns: ["src/ignored/**", "**/*.tsx"],
      extensions: ["ts", ".js"],
    });
    const relativeFiles = files.map((file) => relative(directory, file));

    expect(relativeFiles).toEqual([
      join("src", "index.ts"),
      join("src", "script.js"),
    ]);
  });

  it("rejects empty and invalid custom extensions", async () => {
    const directory = await createTemporaryDirectory();

    await expect(
      findSourceFiles(directory, { extensions: [] }),
    ).rejects.toThrow("at least one source extension is required");
    await expect(
      findSourceFiles(directory, { extensions: ["*.ts"] }),
    ).rejects.toThrow("invalid source extension");
  });
});

describe("CLI", () => {
  it("previews without writing, writes explicitly, and checks clean output", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "example.ts");
    const original = 'import value from "./value.ts";\n';
    await writeFile(filePath, original, "utf8");

    const preview = await runCli([filePath], directory);
    expect(preview.code).toBe(0);
    expect(preview.stdout).toContain("would update " + basename(filePath));
    expect(preview.stdout).toContain("1 of 1 file would change");
    expect(await readFile(filePath, "utf8")).toBe(original);

    const check = await runCli(["--check", filePath], directory);
    expect(check.code).toBe(1);
    expect(check.stdout).toContain("1 of 1 file needs changes");
    expect(await readFile(filePath, "utf8")).toBe(original);

    const write = await runCli(["--write", filePath], directory);
    expect(write.code).toBe(0);
    expect(write.stdout).toContain("updated " + basename(filePath));
    expect(await readFile(filePath, "utf8")).toBe(
      'import value from "./value";\n',
    );

    const clean = await runCli(["--check", filePath], directory);
    expect(clean.code).toBe(0);
    expect(clean.stdout).toContain("0 of 1 files need changes");
  });

  it("prints help and version", async () => {
    const directory = await createTemporaryDirectory();
    const help = await runCli(["--help"], directory);
    const version = await runCli(["--version"], directory);

    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: extensionless-imports");
    expect(help.stdout).toContain("--ignore <pattern>");
    expect(help.stdout).toContain("--extensions <list>");
    expect(help.stdout).toContain("--verbose");
    expect(help.stdout).toContain("--watch");
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(packageJson.version);
  });

  it("supports ignore patterns, extension filters, and verbose output", async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, "src", "ignored"), { recursive: true });

    await Promise.all([
      writeFile(
        join(directory, "src", "change.ts"),
        'import value from "./value.ts";\n',
        "utf8",
      ),
      writeFile(
        join(directory, "src", "clean.ts"),
        'import value from "./value";\n',
        "utf8",
      ),
      writeFile(
        join(directory, "src", "skip.js"),
        'import value from "./value.js";\n',
        "utf8",
      ),
      writeFile(
        join(directory, "src", "ignored", "skip.ts"),
        'import value from "./value.ts";\n',
        "utf8",
      ),
    ]);

    const result = await runCli(
      [
        "--extensions",
        "ts",
        "--ignore",
        "src/ignored/**",
        "--verbose",
        "src",
      ],
      directory,
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("mode: preview");
    expect(result.stdout).toContain("extensions: ts");
    expect(result.stdout).toContain("ignore patterns: src/ignored/**");
    expect(result.stdout).toContain("found 2 source files");
    expect(result.stdout).toContain("would update");
    expect(result.stdout).toContain("(1 replacement)");
    expect(result.stdout).toContain("unchanged");
    expect(result.stdout).toContain("1 of 2 files would change");
  });

  it("supports package subpaths through the CLI", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "example.ts");
    await writeFile(
      filePath,
      'import helper from "some-package/helper.js";\n',
      "utf8",
    );

    const defaultResult = await runCli([filePath], directory);
    const includedResult = await runCli(
      ["--include-package-subpaths", filePath],
      directory,
    );

    expect(defaultResult.code).toBe(0);
    expect(defaultResult.stdout).toContain("0 of 1 file would change");
    expect(includedResult.code).toBe(0);
    expect(includedResult.stdout).toContain("1 of 1 file would change");
  });

  it("writes imports in a directory containing realistic TSX", async () => {
    const directory = await createTemporaryDirectory();
    const routesDirectory = join(directory, "src", "routes");
    const filePath = join(routesDirectory, "__root.tsx");
    await mkdir(routesDirectory, { recursive: true });
    await writeFile(
      filePath,
      [
        'import { ThemeProvider } from "../ThemeProvider.tsx";',
        "",
        "export const Root = () => (",
        "  <ThemeProvider>",
        "    <button onClick={() => toast.add({ title: 'Ready' })}>",
        "      Toast smoke test",
        "    </button>",
        "  </ThemeProvider>",
        ");",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["--write", routesDirectory], directory);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(await readFile(filePath, "utf8")).toContain(
      'from "../ThemeProvider"',
    );
  });

  it("recovers after a TSX parse error in watch mode", async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, "src"), { recursive: true });
    const filePath = join(directory, "src", "example.tsx");
    await writeFile(
      filePath,
      'import value from "./value";\nexport const View = () => <div>;\n',
      "utf8",
    );

    const child = spawn(
      process.execPath,
      [cliPath, "--write", "--watch", "--verbose", "src"],
      {
        cwd: directory,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    try {
      await waitUntil(
        () =>
          stdout.includes("watching for changes") &&
          stderr.includes("Failed to parse") &&
          stderr.includes("example.tsx"),
        "watcher did not become ready",
      );

      await writeFile(
        filePath,
        [
          'import value from "./value.ts";',
          "export const View = () => <div>Ready</div>;",
          "",
        ].join("\n"),
        "utf8",
      );

      await waitUntil(
        async () =>
          (await readFile(filePath, "utf8")) ===
          [
            'import value from "./value";',
            "export const View = () => <div>Ready</div>;",
            "",
          ].join("\n"),
        "watcher did not rewrite the saved file",
      );

      expect(stdout).toContain("updated");
      expect(stdout).toContain("(1 replacement)");
      expect(stderr).toContain("Failed to parse");
    } finally {
      const closePromise =
        child.exitCode === null
          ? new Promise<void>((resolveClose) => {
              child.once("close", () => resolveClose());
            })
          : Promise.resolve();
      if (child.exitCode === null) child.kill();
      await closePromise;
    }
  }, 10_000);

  it("reports invalid and conflicting options", async () => {
    const directory = await createTemporaryDirectory();
    const unknown = await runCli(["--unknown"], directory);
    const conflict = await runCli(["--write", "--check"], directory);
    const missingIgnore = await runCli(["--ignore"], directory);
    const missingExtensions = await runCli(["--extensions"], directory);
    const invalidExtensions = await runCli(
      ["--extensions", "ts,*.js"],
      directory,
    );
    const watchWithoutWrite = await runCli(["--watch"], directory);
    const watchWithCheck = await runCli(
      ["--check", "--watch"],
      directory,
    );

    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("unknown option: --unknown");
    expect(conflict.code).toBe(2);
    expect(conflict.stderr).toContain(
      "--write and --check cannot be used together",
    );
    expect(missingIgnore.code).toBe(2);
    expect(missingIgnore.stderr).toContain("--ignore requires a value");
    expect(missingExtensions.code).toBe(2);
    expect(missingExtensions.stderr).toContain(
      "--extensions requires a value",
    );
    expect(invalidExtensions.code).toBe(2);
    expect(invalidExtensions.stderr).toContain(
      "invalid source extension: *.js",
    );
    expect(watchWithoutWrite.code).toBe(2);
    expect(watchWithoutWrite.stderr).toContain("--watch requires --write");
    expect(watchWithCheck.code).toBe(2);
    expect(watchWithCheck.stderr).toContain("--watch requires --write");
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "extensionless-imports-"));
  temporaryDirectories.push(directory);
  return directory;
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolveResult({ code, stdout, stderr });
    });
  });
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  failureMessage: string,
  timeoutMilliseconds = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }

  throw new Error(failureMessage);
}

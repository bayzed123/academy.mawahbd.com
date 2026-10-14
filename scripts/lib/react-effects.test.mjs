import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/*
 * React treats whatever an effect callback returns as its cleanup function and calls it later. An arrow with an expression
 * body therefore returns the value of that expression, and browsers change those values: Chrome 153 made
 * window.scrollTo() / scrollBy() / scrollIntoView() return a Promise (it used to return nothing), so
 * `useEffect(() => window.scrollTo(...))` made React throw "x is not a function" on the first navigation and the
 * whole student app went blank. TypeScript cannot see it (the DOM types say "void"), so this reads the sources instead:
 * an effect callback must have a block body (or return a cleanup function), and must not be async.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}

test("React effect callbacks have block bodies, so they never return a value by accident", () => {
  // group 1: "async", group 2: a block body or a nested arrow (a real cleanup function)
  const effect = /\buse(?:Layout|Insertion)?Effect\(\s*(async\s+)?(?:\([^)]*\)|\w+)\s*=>\s*(\{|\([^)]*\)\s*=>)?/g;
  const problems = [];
  for (const dir of ["app/src", "admin/src"]) {
    for (const file of sources(join(root, dir))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(effect)) {
        if (m[1] || !m[2]) {
          const line = text.slice(0, m.index).split("\n").length;
          problems.push(`${relative(root, file)}:${line} — ${m[1] ? "async effect" : "expression body"}; use { ... } and return only a cleanup function`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

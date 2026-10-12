import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const map = {
  "#6366f1": "#6c47ff",
  "#4f46e5": "#5b38ee",
  "#4338ca": "#4a2cc7",
  "#7f82f5": "#9d85ff",
  "#a2a8fb": "#bfaeff",
  "#e0e3ff": "#ebe5ff",
};

let changed = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx|ts|css)$/.test(name)) {
      const before = readFileSync(p, "utf8");
      let after = before;
      for (const [from, to] of Object.entries(map))
        after = after.replace(new RegExp(from, "gi"), to);
      if (after !== before) {
        writeFileSync(p, after, "utf8");
        changed++;
        console.log("updated", p);
      }
    }
  }
};
walk("src");
console.log(`Done. ${changed} file(s) updated.`);
// Regenerates README.md = scripts/README.head.md + generated tool table + footer.
import { readFileSync, writeFileSync } from "node:fs";
import { buildRouteTools } from "../dist/tools.js";
import { formatPrice } from "../dist/catalog.js";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(readFileSync(new URL("catalog.json", root), "utf8"));
const head = readFileSync(new URL("scripts/README.head.md", root), "utf8");
const tools = buildRouteTools(catalog);
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");

let out = head;
out += `## Tools (${tools.length} route tools + 2 meta tools)\n\n`;
out += "| Product | Price / call | Tools |\n| --- | --- | --- |\n";
for (const p of catalog.products) {
  const ts = tools.filter((t) => t.product.id === p.id);
  out += `| \`${p.id}\` ${esc(p.title)} | ${formatPrice(p.price_atomic)} | ${ts.length} |\n`;
}
out += "\n| Tool | Route | Description | Price |\n| --- | --- | --- | --- |\n";
for (const t of tools) {
  out += `| \`${t.name}\` | \`GET /${t.product.id}${t.route.path}\` | ${esc(t.route.summary)} | ${
    t.free ? "free" : formatPrice(t.product.price_atomic)
  } |\n`;
}
out += `\n## License\n\nMIT (c) Lilambd Crossing\n`;
writeFileSync(new URL("README.md", root), out);
console.log(`README.md written (${tools.length} tools)`);

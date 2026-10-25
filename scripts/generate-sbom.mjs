import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const components = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path || !entry.version) continue;
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index < 0) continue;
  const name = path.slice(index + marker.length);
  components.push({
    type: "library",
    name,
    version: entry.version,
    scope: entry.dev ? "development" : "required",
    purl: "pkg:npm/" + name.replace("/", "%2F") + "@" + entry.version,
  });
}
const cargo = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1"], { encoding: "utf8" }));
for (const entry of cargo.packages ?? []) {
  if (!entry.source) continue;
  components.push({
    type: "library",
    name: entry.name,
    version: entry.version,
    scope: "required",
    license: entry.license ?? undefined,
    purl: "pkg:cargo/" + entry.name + "@" + entry.version,
  });
}
const unique = new Map(components.map((component) => [component.purl, component]));
const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: { component: { type: "application", name: "modipdfy", version: "0.1.0", licenses: [{ license: { id: "MIT" } }] } },
  components: [...unique.values()].sort((left, right) => left.purl.localeCompare(right.purl)),
};
writeFileSync("docs/sbom.json", JSON.stringify(bom, null, 2) + "\n");
console.log("Wrote docs/sbom.json with " + bom.components.length + " components.");

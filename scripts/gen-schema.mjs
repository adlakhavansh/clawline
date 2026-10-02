// Regenerates schema.json from the segment registry: node scripts/gen-schema.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SEGMENTS } from "../src/segments/index.mjs";
import { THEME_NAMES } from "../src/theme.mjs";
import { STYLE_NAMES, ICON_SETS } from "../src/style.mjs";

const segments = {};
for (const s of SEGMENTS) {
  const properties = {};
  for (const [key, value] of Object.entries(s.options || {})) {
    const type = value === null ? ["string", "null"] : Array.isArray(value) ? "array" : typeof value;
    properties[key] = { type, default: value };
  }
  segments[s.id] = {
    type: "object",
    description: s.hint,
    additionalProperties: false,
    properties,
  };
}

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "clawline config",
  type: "object",
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    theme: { type: "string", enum: THEME_NAMES, default: "dark" },
    style: {
      type: "string",
      enum: STYLE_NAMES,
      default: "plain",
      description: "plain gaps, minimal rules, powerline arrows or capsule pills",
    },
    icons: { type: "string", enum: ICON_SETS, default: "none", description: "nerd needs a Nerd Font" },
    separator: { type: "string", default: "  ", description: "text between segments" },
    padding: { type: "integer", minimum: 0, default: 0 },
    rows: {
      type: "array",
      description: "each row is an ordered list of segment ids; a segment not listed is off",
      items: { type: "array", items: { type: "string", enum: SEGMENTS.map((s) => s.id) } },
    },
    segments: { type: "object", additionalProperties: false, properties: segments },
  },
};

const out = fileURLToPath(new URL("../schema.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`schema.json written with ${SEGMENTS.length} segments`);

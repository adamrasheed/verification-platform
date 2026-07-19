import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const file = path.join(process.cwd(), "docs/compliance/MVP_COMPLIANCE.csv");
const lines = (await readFile(file, "utf8")).trim().split(/\r?\n/);
const expectedHeader = "requirement_id,source_clause,owner,planned_control,status";
const errors = [];
if (lines[0] !== expectedHeader) errors.push("compliance matrix header is invalid");
const ids = new Set();

for (const [index, line] of lines.slice(1).entries()) {
  const values = line.split(",");
  if (values.length !== 5 || values.some((value) => !value.trim())) {
    errors.push(`compliance row ${index + 2} must have five non-empty fields`);
    continue;
  }
  const [id, source, owner, control, status] = values;
  if (ids.has(id)) errors.push(`duplicate compliance requirement ${id}`);
  ids.add(id);
  if (!source.startsWith("Freeze §")) errors.push(`${id}: source must identify a Freeze clause`);
  if (!["planned", "implemented", "deferred"].includes(status)) errors.push(`${id}: invalid status`);
  if (control.length < 8 || owner.length < 3) errors.push(`${id}: owner/control too vague`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`compliance matrix valid: ${ids.size} MVP requirements assigned`);

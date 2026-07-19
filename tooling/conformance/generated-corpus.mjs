import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export async function createNpmWorkspace(root, options = {}) {
  const workspaceCount = options.workspaceCount ?? 2;
  await mkdir(root, { recursive: true });
  const rootManifest = `${JSON.stringify({
      name: options.name ?? "generated-reference",
      private: true,
      workspaces: ["packages/*"],
    })}\n`;
  await writeFile(path.join(root, "package.json"), rootManifest);
  let byteCount = Buffer.byteLength(rootManifest);
  const packages = {
    "": {
      name: options.name ?? "generated-reference",
      workspaces: ["packages/*"],
    },
  };
  for (let index = 0; index < workspaceCount; index += 1) {
    const relative = `packages/p${String(index).padStart(4, "0")}`;
    const directory = path.join(root, relative);
    await mkdir(directory, { recursive: true });
    const name = options.packageNames?.[index] ??
      `@generated/p${String(index).padStart(4, "0")}`;
    const manifest = `${JSON.stringify({ name, version: "1.0.0" })}\n`;
    await writeFile(path.join(directory, "package.json"), manifest);
    byteCount += Buffer.byteLength(manifest);
    packages[relative] = { name, version: "1.0.0" };
  }
  const lockfile = `${JSON.stringify({
      name: options.name ?? "generated-reference",
      lockfileVersion: 3,
      packages,
    })}\n`;
  await writeFile(path.join(root, "package-lock.json"), lockfile);
  return {
    fileCount: workspaceCount + 2,
    byteCount: byteCount + Buffer.byteLength(lockfile),
  };
}

export async function createOrdinaryFiles(
  root,
  fileCount,
  options = {},
) {
  const filesPerDirectory = options.filesPerDirectory ?? 1000;
  const batchSize = options.batchSize ?? 512;
  for (let batchStart = 0; batchStart < fileCount; batchStart += batchSize) {
    const writes = [];
    const end = Math.min(fileCount, batchStart + batchSize);
    for (let index = batchStart; index < end; index += 1) {
      const directory = path.join(
        root,
        "ordinary",
        String(Math.floor(index / filesPerDirectory)).padStart(4, "0"),
      );
      writes.push((async () => {
        await mkdir(directory, { recursive: true });
        const content = `${index}\n`;
        await writeFile(
          path.join(directory, `${String(index).padStart(6, "0")}.txt`),
          content,
        );
        byteCount += Buffer.byteLength(content);
      })());
    }
    await Promise.all(writes);
  }
  return { fileCount, byteCount };
}

export async function createReference100kCorpus(root) {
  const workspace = await createNpmWorkspace(root, { workspaceCount: 0 });
  // package.json + package-lock.json + 99,998 ordinary files = 100,000.
  const ordinary = await createOrdinaryFiles(root, 99_998);
  return {
    fileCount: workspace.fileCount + ordinary.fileCount,
    byteCount: workspace.byteCount + ordinary.byteCount,
  };
}
  let byteCount = 0;

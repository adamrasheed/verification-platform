import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { spawn } from "node:child_process";

export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalStringify(value[key])}`
  ).join(",")}}`;
}

export function canonicalDocument(value) {
  return `${canonicalStringify(value)}\n`;
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function digestFile(path) {
  const bytes = await readFile(path);
  return { digest: sha256Bytes(bytes), size: bytes.byteLength };
}

export async function writeCanonical(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, canonicalDocument(value), { mode: 0o600 });
  await rename(temporary, path);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function parseTarString(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  return buffer.subarray(start, end === -1 || end > start + length
    ? start + length
    : end).toString("utf8");
}

function parseTarOctal(buffer, start, length) {
  const value = parseTarString(buffer, start, length).trim();
  return value === "" ? 0 : Number.parseInt(value, 8);
}

export function inspectNpmTarball(bytes) {
  const tar = gunzipSync(bytes);
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const expectedChecksum = parseTarOctal(header, 148, 8);
    let actualChecksum = 0;
    for (let index = 0; index < header.length; index += 1) {
      actualChecksum += index >= 148 && index < 156 ? 32 : header[index];
    }
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`invalid tar header checksum at offset ${offset}`);
    }
    const name = parseTarString(header, 0, 100);
    const prefix = parseTarString(header, 345, 155);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const mode = parseTarOctal(header, 100, 8);
    const size = parseTarOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const bodyStart = offset + 512;
    const body = tar.subarray(bodyStart, bodyStart + size);
    entries.push({
      path,
      mode,
      size,
      type,
      digest: sha256Bytes(body),
      body,
    });
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function allowedPath(path, policy) {
  return policy.allowedTarFiles.includes(path) ||
    policy.allowedTarPrefixes.some((prefix) => path.startsWith(prefix));
}

export function validatePackedArtifact(entries, policy) {
  const errors = [];
  const paths = entries.map(({ path }) => path);
  for (const entry of entries) {
    if (entry.path.startsWith("/") || entry.path.split("/").includes("..")) {
      errors.push(`unsafe tar path ${entry.path}`);
    }
    if (!["0", "5"].includes(entry.type)) {
      errors.push(`unsupported tar entry type ${entry.type} at ${entry.path}`);
    }
    if (!allowedPath(entry.path, policy)) {
      errors.push(`undeclared packed file ${entry.path}`);
    }
    if (policy.forbiddenPathFragments.some((value) =>
      entry.path.includes(value)
    )) {
      errors.push(`forbidden packed path ${entry.path}`);
    }
  }
  for (const required of policy.requiredTarFiles) {
    if (!paths.includes(required)) errors.push(`missing packed file ${required}`);
  }
  const manifestEntry = entries.find(({ path }) =>
    path === "package/package.json"
  );
  if (manifestEntry === undefined) {
    return { errors, manifest: undefined };
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.body.toString("utf8"));
  } catch {
    errors.push("packed package.json is not valid JSON");
    return { errors, manifest: undefined };
  }
  if (manifest.private === true) errors.push("release package remains private");
  for (const script of policy.forbiddenLifecycleScripts) {
    if (manifest.scripts?.[script] !== undefined) {
      errors.push(`forbidden lifecycle script ${script}`);
    }
  }
  for (const [dependency, version] of Object.entries(
    manifest.dependencies ?? {},
  )) {
    if (policy.forbiddenDependencyPrefixes.some((prefix) =>
      dependency.startsWith(prefix)
    )) {
      errors.push(`unpublishable internal dependency ${dependency}`);
    }
    if (String(version).startsWith("workspace:")) {
      errors.push(`workspace dependency protocol ${dependency}`);
    }
  }
  for (const [name, target] of Object.entries(manifest.bin ?? {})) {
    const normalized = `package/${String(target).replace(/^\.\//, "")}`;
    const entry = entries.find(({ path }) => path === normalized);
    if (entry === undefined) errors.push(`missing bin target ${name}: ${normalized}`);
    else if ((entry.mode & 0o111) === 0) {
      errors.push(`bin target is not executable ${normalized}`);
    }
  }
  return { errors, manifest };
}

export function packFileManifest(entries) {
  return {
    schemaVersion: 1,
    files: entries
      .filter(({ type }) => type === "0")
      .map(({ path, mode, size, digest }) => ({
        path,
        mode,
        size,
        sha256: digest,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export async function buildSbom(root, packageDirectory, packedManifest) {
  const rootLock = await readJson(join(root, "package-lock.json"));
  const packagePath = relative(root, packageDirectory).split(sep).join("/");
  const lockPackage = rootLock.packages?.[packagePath] ?? {};
  const directDependencies =
    packedManifest.dependencies ?? lockPackage.dependencies ?? {};
  const rootComponent = {
    type: "application",
    name: packedManifest.name,
    version: packedManifest.version,
    purl: `pkg:npm/${encodeURIComponent(packedManifest.name)}@${packedManifest.version}`,
  };
  const components = [];
  const dependencyGraph = new Map();
  const queue = Object.keys(directDependencies).sort();
  const visited = new Set();
  const lockedPackage = (name) => {
    const entry = rootLock.packages?.[`node_modules/${name}`];
    return entry?.link === true && entry.resolved !== undefined
      ? rootLock.packages?.[entry.resolved]
      : entry;
  };
  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    visited.add(name);
    const locked = lockedPackage(name);
    const version = locked?.version ?? directDependencies[name] ?? "unknown";
    const purl = `pkg:npm/${encodeURIComponent(name)}@${version}`;
    components.push({
      type: "library",
      name,
      version,
      purl,
    });
    const children = Object.keys(locked?.dependencies ?? {}).sort();
    dependencyGraph.set(purl, children);
    queue.push(...children);
  }
  components.sort((left, right) => left.purl.localeCompare(right.purl));
  const purlByName = new Map(components.map((component) => [
    component.name,
    component.purl,
  ]));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: rootComponent,
      tools: [{
        vendor: "verification-platform",
        name: "tooling/release",
        version: "1",
      }],
    },
    components,
    dependencies: [
      {
        ref: rootComponent.purl,
        dependsOn: Object.keys(directDependencies)
          .map((name) => purlByName.get(name))
          .filter(Boolean)
          .sort(),
      },
      ...components.map((component) => ({
        ref: component.purl,
        dependsOn: (dependencyGraph.get(component.purl) ?? [])
          .map((name) => purlByName.get(name))
          .filter(Boolean)
          .sort(),
      })),
    ],
  };
}

export function buildProvenance({
  artifactName,
  artifactDigest,
  artifactSize,
  packageDirectory,
  packageName,
  packageVersion,
  sourceRevision,
  sbomDigest,
  nodeVersion,
  npmVersion,
}) {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: artifactName,
      digest: { sha256: artifactDigest.slice(7) },
    }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://verification-platform.invalid/npm-pack/v1",
        externalParameters: {
          packageDirectory,
          packageName,
          packageVersion,
          sourceRevision,
        },
        internalParameters: {},
        resolvedDependencies: [{
          uri: "sbom.cdx.json",
          digest: { sha256: sbomDigest.slice(7) },
        }],
      },
      runDetails: {
        builder: { id: "verification-platform/tooling-release@1" },
        metadata: {
          invocationId: `${artifactDigest}:${nodeVersion}:${npmVersion}`,
        },
      },
    },
  };
}

export async function validateCandidate(candidatePath) {
  const candidate = await readJson(candidatePath);
  const base = dirname(candidatePath);
  const failures = [];
  const checked = [
    ["artifact", candidate.artifact],
    ["packManifest", candidate.packManifest],
    ["sbom", candidate.sbom],
    ["provenance", candidate.provenance],
    ["performanceReport", candidate.performanceReport],
    ["securityReport", candidate.securityReport],
    ["testAttestation", candidate.testAttestation],
  ];
  for (const [name, reference] of checked) {
    if (reference?.path === undefined || reference?.sha256 === undefined) {
      failures.push(`missing ${name} reference`);
      continue;
    }
    const actual = await digestFile(resolve(base, reference.path));
    if (actual.digest !== reference.sha256) {
      failures.push(`${name} digest mismatch`);
    }
    if (reference.size !== undefined && actual.size !== reference.size) {
      failures.push(`${name} size mismatch`);
    }
  }
  if (candidate.status !== "ready") failures.push("candidate is not ready");
  if (!/^[a-f0-9]{40,64}$/.test(candidate.source?.sourceRevision ?? "")) {
    failures.push("candidate lacks an exact source revision");
  }
  const attestation = candidate.testAttestation?.path === undefined
    ? undefined
    : await readJson(resolve(base, candidate.testAttestation.path));
  if (attestation?.artifactSha256 !== candidate.artifact?.sha256) {
    failures.push("test attestation does not bind candidate artifact bytes");
  }
  if (attestation?.exitCode !== 0 || attestation?.status !== "passed") {
    failures.push("tested-byte attestation did not pass");
  }
  return { candidate, failures };
}

export async function promoteCandidate(candidatePath, destination) {
  const { candidate, failures } = await validateCandidate(candidatePath);
  if (failures.length > 0) throw new Error(failures.join("\n"));
  const source = resolve(dirname(candidatePath), candidate.artifact.path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, 1);
  const promoted = await digestFile(destination);
  if (promoted.digest !== candidate.artifact.sha256) {
    await rm(destination, { force: true });
    throw new Error("promoted artifact bytes changed");
  }
  return promoted;
}

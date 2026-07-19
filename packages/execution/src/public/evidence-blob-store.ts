import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Sha256Digest } from "@verify-internal/contracts";

export type BlobFaultPoint =
  | "after-stage-write"
  | "after-stage-sync"
  | "before-publish"
  | "after-publish";

export type BlobFaultInjector = (point: BlobFaultPoint) => void;

export interface StagedEvidenceBlob {
  readonly stagingId: string;
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly byteSize: number;
}

export interface BlobRecoveryReport {
  readonly removedStagingFiles: readonly string[];
  readonly corruptBlobDigests: readonly Sha256Digest[];
  readonly removedOrphanBlobDigests: readonly Sha256Digest[];
}

export class EvidenceBlobIntegrityError extends Error {
  readonly digest: Sha256Digest;

  constructor(digest: Sha256Digest, message: string) {
    super(`Evidence blob ${digest}: ${message}`);
    this.name = "EvidenceBlobIntegrityError";
    this.digest = digest;
  }
}

function digestBytes(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestHex(digest: Sha256Digest): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError("invalid SHA-256 digest");
  }
  return digest.slice(7);
}

export class EvidenceBlobStore {
  readonly #root: string;
  readonly #fault: BlobFaultInjector | undefined;

  constructor(root: string, fault?: BlobFaultInjector) {
    this.#root = root;
    this.#fault = fault;
  }

  private stagingPath(stagingId: string): string {
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(stagingId)) {
      throw new TypeError("stagingId contains unsafe characters");
    }
    return join(this.#root, "stage", `${stagingId}.blob`);
  }

  pathFor(digest: Sha256Digest): string {
    const hex = digestHex(digest);
    return join(this.#root, "blobs", hex.slice(0, 2), hex);
  }

  async stage(
    bytes: Uint8Array,
    stagingId: string,
  ): Promise<StagedEvidenceBlob> {
    const path = this.stagingPath(stagingId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      this.#fault?.("after-stage-write");
      await handle.sync();
      this.#fault?.("after-stage-sync");
    } catch (error) {
      await handle.close();
      await rm(path, { force: true });
      throw error;
    }
    await handle.close();
    return {
      stagingId,
      path,
      digest: digestBytes(bytes),
      byteSize: bytes.byteLength,
    };
  }

  async commit(staged: StagedEvidenceBlob): Promise<string> {
    const bytes = await readFile(staged.path);
    if (
      digestBytes(bytes) !== staged.digest ||
      bytes.byteLength !== staged.byteSize
    ) {
      throw new EvidenceBlobIntegrityError(
        staged.digest,
        "staged content failed integrity validation",
      );
    }
    const destination = this.pathFor(staged.digest);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    this.#fault?.("before-publish");
    try {
      await rename(staged.path, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await this.read(staged.digest);
      await rm(staged.path, { force: true });
    }
    this.#fault?.("after-publish");
    await this.read(staged.digest);
    return destination;
  }

  async discard(staged: StagedEvidenceBlob): Promise<void> {
    await rm(staged.path, { force: true });
  }

  async read(digest: Sha256Digest): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(this.pathFor(digest));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new EvidenceBlobIntegrityError(digest, "missing");
      }
      throw error;
    }
    if (digestBytes(bytes) !== digest) {
      throw new EvidenceBlobIntegrityError(digest, "digest mismatch");
    }
    return bytes;
  }

  async recover(
    referencedDigests?: ReadonlySet<Sha256Digest>,
  ): Promise<BlobRecoveryReport> {
    const removedStagingFiles: string[] = [];
    const stageDirectory = join(this.#root, "stage");
    try {
      for (const entry of await readdir(stageDirectory)) {
        const path = join(stageDirectory, entry);
        if ((await stat(path)).isFile()) {
          await rm(path, { force: true });
          removedStagingFiles.push(entry);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const corruptBlobDigests: Sha256Digest[] = [];
    const removedOrphanBlobDigests: Sha256Digest[] = [];
    const blobDirectory = join(this.#root, "blobs");
    try {
      for (const prefix of await readdir(blobDirectory)) {
        const prefixPath = join(blobDirectory, prefix);
        if (!(await stat(prefixPath)).isDirectory()) continue;
        for (const name of await readdir(prefixPath)) {
          if (!/^[a-f0-9]{64}$/.test(name)) continue;
          const expected = `sha256:${name}` as Sha256Digest;
          try {
            await this.read(expected);
            if (
              referencedDigests !== undefined &&
              !referencedDigests.has(expected)
            ) {
              await rm(join(prefixPath, name), { force: true });
              removedOrphanBlobDigests.push(expected);
            }
          } catch (error) {
            if (error instanceof EvidenceBlobIntegrityError) {
              corruptBlobDigests.push(expected);
            } else {
              throw error;
            }
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return {
      removedStagingFiles: removedStagingFiles.sort(),
      corruptBlobDigests: corruptBlobDigests.sort(),
      removedOrphanBlobDigests: removedOrphanBlobDigests.sort(),
    };
  }
}

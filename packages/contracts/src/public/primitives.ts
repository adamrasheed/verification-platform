declare const opaqueIdBrand: unique symbol;
declare const nonNegativeIntegerBrand: unique symbol;
declare const ratioBrand: unique symbol;

export type OpaqueId = string & { readonly [opaqueIdBrand]: "OpaqueId" };
export type Sha256Digest = `sha256:${string}`;
export type Rfc3339Utc = string;
export type DurationMs = number & {
  readonly [nonNegativeIntegerBrand]: "DurationMs";
};
export type ByteCount = number & {
  readonly [nonNegativeIntegerBrand]: "ByteCount";
};
export type Ratio = number & { readonly [ratioBrand]: "Ratio" };

export type DataClassification =
  | "SECRET"
  | "LOCAL_SOURCE"
  | "SENSITIVE_EVIDENCE"
  | "MINIMAL_METADATA"
  | "EXPLICIT_SHARE";

export type CanonicalScalar = null | boolean | number | string;
export type CanonicalValue =
  | CanonicalScalar
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export interface ExtensionEntry {
  readonly namespace: string;
  readonly schemaVersion: number;
  readonly value: CanonicalValue;
}

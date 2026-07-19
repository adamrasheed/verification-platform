import type {
  CanonicalValue,
  DataClassification,
  OpaqueId,
  ProducerRef,
  RevisionRef,
  Rfc3339Utc,
} from "@verify-internal/contracts";

export interface EventEnvelope<
  TType extends string = string,
  TPayload = CanonicalValue,
> {
  readonly schemaVersion: number;
  readonly eventId: OpaqueId;
  readonly eventType: TType;
  readonly occurredAt: Rfc3339Utc;
  readonly invocationId: OpaqueId;
  readonly subject?: RevisionRef;
  readonly causationId?: OpaqueId;
  readonly correlationId: OpaqueId;
  readonly sequence: number;
  readonly producer: ProducerRef;
  readonly dataClassification: DataClassification;
  readonly payload: TPayload;
}

export type EventCriticality = "informational" | "reconstruction-critical";

export type EventPayloadValidator<TPayload> = (
  value: unknown,
) => value is TPayload;

export interface EventDescriptor<
  TType extends string = string,
  TPayload = CanonicalValue,
> {
  readonly eventType: TType;
  readonly schemaVersion: number;
  readonly criticality: EventCriticality;
  readonly validatePayload: EventPayloadValidator<TPayload>;
}

export interface EventRegistry {
  readonly descriptors: readonly EventDescriptor[];
  resolve(
    eventType: string,
    schemaVersion: number,
  ): EventDescriptor | undefined;
}

export type EventFromDescriptor<
  TDescriptor extends EventDescriptor,
> = TDescriptor extends EventDescriptor<infer TType, infer TPayload>
  ? EventEnvelope<TType, TPayload>
  : never;

export class EventRegistryError extends TypeError {
  readonly code:
    | "DUPLICATE_EVENT_DESCRIPTOR"
    | "INVALID_EVENT_SCHEMA_VERSION"
    | "INVALID_EVENT_TYPE";

  constructor(
    code: EventRegistryError["code"],
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "EventRegistryError";
    this.code = code;
  }
}

function registryKey(eventType: string, schemaVersion: number): string {
  return `${eventType}\u0000${schemaVersion}`;
}

export function createEventRegistry(
  descriptors: readonly EventDescriptor[],
): EventRegistry {
  const entries = new Map<string, EventDescriptor>();
  const snapshot = [...descriptors];

  for (const descriptor of snapshot) {
    if (descriptor.eventType.length === 0) {
      throw new EventRegistryError(
        "INVALID_EVENT_TYPE",
        "eventType must not be empty",
      );
    }
    if (
      !Number.isSafeInteger(descriptor.schemaVersion) ||
      descriptor.schemaVersion < 1
    ) {
      throw new EventRegistryError(
        "INVALID_EVENT_SCHEMA_VERSION",
        `${descriptor.eventType} must use a positive safe integer`,
      );
    }

    const key = registryKey(descriptor.eventType, descriptor.schemaVersion);
    if (entries.has(key)) {
      throw new EventRegistryError(
        "DUPLICATE_EVENT_DESCRIPTOR",
        `${descriptor.eventType} v${descriptor.schemaVersion}`,
      );
    }
    entries.set(key, descriptor);
  }

  return Object.freeze({
    descriptors: Object.freeze(snapshot),
    resolve(
      eventType: string,
      schemaVersion: number,
    ): EventDescriptor | undefined {
      return entries.get(registryKey(eventType, schemaVersion));
    },
  });
}

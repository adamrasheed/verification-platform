import type { ProtocolReadResult } from "./decode.js";
import type {
  AnyCommandEnvelope,
  VerifyResult,
} from "./types.js";

export type CliExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function cliExitCodeForEnvelope(
  envelope: AnyCommandEnvelope,
): CliExitCode {
  switch (envelope.operationalStatus) {
    case "internal_error":
      return 6;
    case "cancelled":
      return 5;
    case "invalid":
      return 3;
    case "blocked":
      return 4;
    case "completed": {
      if (envelope.command !== "verify") return 0;
      const result = envelope.result as VerifyResult;
      switch (result.outcome) {
        case "satisfied":
          return 0;
        case "violated":
          return 1;
        case "indeterminate":
        case "not_evaluated":
          return 2;
      }
    }
  }
}

export function cliExitCodeForReadResult(
  read: ProtocolReadResult<AnyCommandEnvelope>,
): CliExitCode {
  if (read.kind === "incompatible_result") return 6;
  if (read.kind === "invalid") return 3;
  return cliExitCodeForEnvelope(read.value);
}

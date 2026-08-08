# M9 SQS Relay and Worker

M9-T05 connects the PostgreSQL transactional outbox to the existing encrypted
Amazon SQS standard queue. SQS is transport only: PostgreSQL remains
authoritative and queue delivery never becomes a Proof attempt.

## Transport contract

The relay claims one PostgreSQL outbox row under the existing expiring fenced
lease, sends one canonical `publicationOutboxReference`, and acknowledges the
row only after SQS accepts the message. A send/acknowledgement race can create a
duplicate queue delivery; the stable event ID and consumer receipt make that
duplicate a no-op.

The SQS body contains exactly:

- schema and envelope kind;
- tenant and stable event IDs;
- accepted/deleted event type; and
- published-run aggregate type and opaque ID.

It does not contain the source event payload, a payload digest, source, secret,
path, command, prompt, environment, or error text. The same minimal body is
therefore safe when the source-bound redrive policy moves an exhausted message
to the dead-letter queue.

## Worker bounds

The worker long-polls at most one message for at most 20 seconds. A successful
or already-processed reference is deleted with its exact receipt handle. A
failure leaves the message unacknowledged and applies bounded exponential
visibility delay with jitter until the configured maximum receive count. The
fifth failed receive is left for the queue's existing source-bound DLQ redrive;
application error strings are neither attached to the message nor retained by
the adapter.

The concrete AWS transport accepts only the fixed HTTPS queue URL for the exact
account, `us-west-2` region, and queue name. Workload IAM and the SQS interface
endpoint must independently restrict send, receive, visibility, and delete
actions to the primary metadata queue. DLQ reads are reserved for the protected
conformance and operator path.

## Required protected run

The deployment gate must prove all of the following against the development
RDS and SQS resources:

1. fenced outbox relay and successful queue acknowledgement;
2. duplicate delivery produces one consumer side effect;
3. retry visibility is bounded and the fifth failure redrives one minimal body;
4. neither the primary queue nor DLQ contains source, secret, or digest canaries;
5. deletion-event delivery carries no deleted digest;
6. the closed ten-sink deletion inventory and byte-bounded canary scan pass;
7. all synthetic rows/messages are removed; and
8. ephemeral Fargate, endpoint, image, role, and log resources are removed with
   a final zero-drift plan.

No production delivery, SLO, or recovery claim exists until that protected run
and the later M9-T08 drills are retained as Evidence.

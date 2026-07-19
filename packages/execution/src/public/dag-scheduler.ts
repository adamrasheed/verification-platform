import { CancellationError, type CancellationToken } from "./cancellation.js";

export interface DagNode<T> {
  readonly nodeId: string;
  readonly dependencies: readonly string[];
  readonly stableOrder: number;
  run(token: CancellationToken): Promise<T>;
}

export type DagNodeResult<T> =
  | { readonly nodeId: string; readonly status: "completed"; readonly value: T }
  | { readonly nodeId: string; readonly status: "error"; readonly error: unknown }
  | {
      readonly nodeId: string;
      readonly status: "cancelled";
      readonly reason: CancellationError["reason"];
    };

export interface DagRunResult<T> {
  readonly stableNodeOrder: readonly string[];
  readonly results: readonly DagNodeResult<T>[];
  readonly maximumObservedConcurrency: number;
}

function compareNodes<T>(left: DagNode<T>, right: DagNode<T>): number {
  return left.stableOrder - right.stableOrder ||
    left.nodeId.localeCompare(right.nodeId);
}

export function stableTopologicalOrder<T>(
  nodes: readonly DagNode<T>[],
): readonly DagNode<T>[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  if (byId.size !== nodes.length) throw new TypeError("duplicate DAG node ID");
  const indegree = new Map(nodes.map((node) => [node.nodeId, 0]));
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (!byId.has(dependency)) {
        throw new TypeError(`unknown DAG dependency ${dependency}`);
      }
      indegree.set(node.nodeId, indegree.get(node.nodeId)! + 1);
      const values = dependents.get(dependency) ?? [];
      values.push(node.nodeId);
      dependents.set(dependency, values);
    }
  }
  const ready = nodes.filter((node) => indegree.get(node.nodeId) === 0)
    .sort(compareNodes);
  const ordered: DagNode<T>[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    ordered.push(next);
    for (const dependentId of dependents.get(next.nodeId) ?? []) {
      const remaining = indegree.get(dependentId)! - 1;
      indegree.set(dependentId, remaining);
      if (remaining === 0) {
        ready.push(byId.get(dependentId)!);
        ready.sort(compareNodes);
      }
    }
  }
  if (ordered.length !== nodes.length) throw new TypeError("DAG contains a cycle");
  return ordered;
}

export async function runDeterministicDag<T>(
  nodes: readonly DagNode<T>[],
  maximumConcurrency: number,
  token: CancellationToken,
): Promise<DagRunResult<T>> {
  if (!Number.isSafeInteger(maximumConcurrency) || maximumConcurrency < 1) {
    throw new TypeError("maximumConcurrency must be a positive safe integer");
  }
  const stable = stableTopologicalOrder(nodes);
  const completed = new Set<string>();
  const admitted = new Set<string>();
  const results = new Map<string, DagNodeResult<T>>();
  const running = new Map<string, Promise<void>>();
  let maximumObservedConcurrency = 0;

  const launch = (node: DagNode<T>): void => {
    admitted.add(node.nodeId);
    const work = (async (): Promise<void> => {
      try {
        token.throwIfCancelled();
        const value = await node.run(token);
        token.throwIfCancelled();
        results.set(node.nodeId, {
          nodeId: node.nodeId,
          status: "completed",
          value,
        });
      } catch (error) {
        if (error instanceof CancellationError || token.cancelled) {
          results.set(node.nodeId, {
            nodeId: node.nodeId,
            status: "cancelled",
            reason: error instanceof CancellationError
              ? error.reason
              : token.reason ?? "integrity",
          });
        } else {
          results.set(node.nodeId, {
            nodeId: node.nodeId,
            status: "error",
            error,
          });
        }
      } finally {
        completed.add(node.nodeId);
        running.delete(node.nodeId);
      }
    })();
    running.set(node.nodeId, work);
    maximumObservedConcurrency = Math.max(
      maximumObservedConcurrency,
      running.size,
    );
  };

  while (completed.size < stable.length) {
    if (!token.cancelled) {
      for (const node of stable) {
        if (running.size >= maximumConcurrency) break;
        if (admitted.has(node.nodeId)) continue;
        if (node.dependencies.every((dependency) => completed.has(dependency))) {
          launch(node);
        }
      }
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }

  if (token.cancelled) {
    for (const node of stable) {
      if (!admitted.has(node.nodeId)) {
        results.set(node.nodeId, {
          nodeId: node.nodeId,
          status: "cancelled",
          reason: token.reason ?? "integrity",
        });
      }
    }
  }

  return {
    stableNodeOrder: stable.map(({ nodeId }) => nodeId),
    results: stable.flatMap((node) => {
      const result = results.get(node.nodeId);
      return result === undefined ? [] : [result];
    }),
    maximumObservedConcurrency,
  };
}

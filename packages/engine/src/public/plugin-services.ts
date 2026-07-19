import {
  ProviderEgressBroker,
  ProviderPluginRuntime,
  type PluginRuntimeOptions,
  type ProviderEgressBrokerOptions,
} from "@verify-internal/plugin-runtime";

/**
 * Engine-owned construction prevents adapters and plugins from minting an
 * alternate egress path with weaker validation.
 */
export function createEngineProviderEgressBroker(
  options: ProviderEgressBrokerOptions,
): ProviderEgressBroker {
  return new ProviderEgressBroker(options);
}

/**
 * Engine-owned construction keeps authorization, trust, sandbox and broker
 * dependencies explicit at the composition root.
 */
export function createEnginePluginRuntime(
  options: PluginRuntimeOptions,
): ProviderPluginRuntime {
  return new ProviderPluginRuntime(options);
}

/**
 * Port Registry — DEPRECATED. Re-exports from AgentRegistry.
 *
 * @deprecated Use AgentRegistry instead. This file exists only for
 * backward compatibility during the migration period.
 */

export {
  registerPort,
  unregisterPort,
  startHeartbeatByName as startHeartbeat,
  listInstances,
  allocatePortByName as allocatePort,
} from './AgentRegistry.js';

// Re-export the AgentRegistryEntry as PortEntry for backward compat
export type { AgentRegistryEntry as PortEntry } from './types.js';

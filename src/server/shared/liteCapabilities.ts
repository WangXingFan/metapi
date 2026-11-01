export const MODEL_DISCOVERY_DISABLED_REASON = 'model discovery is disabled in Lite mode';
export const ROUTE_REBUILD_DISABLED_REASON = 'proxy routing is disabled in Lite mode';

export function disabledRouteRebuildResult() {
  return {
    skipped: true as const,
    reason: ROUTE_REBUILD_DISABLED_REASON,
    models: 0,
    createdRoutes: 0,
    createdChannels: 0,
    removedChannels: 0,
    removedRoutes: 0,
  };
}

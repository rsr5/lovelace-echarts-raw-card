import type { HomeAssistant } from "../ha-types";

export function shouldUpdateForHassChange(
  hass: HomeAssistant | undefined,
  watchedEntities: Set<string>,
  lastFingerprints: Map<string, string>,
): boolean {
  if (watchedEntities.size === 0) return false;
  if (!hass?.states) return false;

  for (const entityId of watchedEntities) {
    const st = hass.states[entityId];
    const fp = st ? `${st.state}|${st.last_updated}` : "missing";
    const prev = lastFingerprints.get(entityId);
    if (prev !== fp) return true;
  }

  return false;
}

export function snapshotFingerprints(
  hass: HomeAssistant | undefined,
  watchedEntities: Set<string>,
  lastFingerprints: Map<string, string>,
): void {
  if (!hass?.states) return;

  for (const entityId of watchedEntities) {
    const st = hass.states[entityId];
    const fp = st ? `${st.state}|${st.last_updated}` : "missing";
    lastFingerprints.set(entityId, fp);
  }
}

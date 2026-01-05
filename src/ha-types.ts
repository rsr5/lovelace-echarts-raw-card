export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  themes: {
    darkMode?: boolean;
    theme?: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callService?: (domain: string, service: string, data?: any) => Promise<void>;
}

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

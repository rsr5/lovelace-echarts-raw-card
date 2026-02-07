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
  callApi?(method: string, path: string): Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HA's callWS accepts arbitrary message shapes
  callWS?<T = unknown>(msg: Record<string, any>): Promise<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HA's callService accepts arbitrary data
  callService?: (domain: string, service: string, data?: any) => Promise<void>;
}

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

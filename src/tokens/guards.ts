import type { DataGenerator, HistoryGenerator, TokenObject } from "../types";

export function isDataGenerator(v: unknown): v is DataGenerator {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$data" in v;
}

export function isHistoryGenerator(v: unknown): v is HistoryGenerator {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$history" in v;
}

export function isTokenObject(v: unknown): v is TokenObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$entity" in v;
}

export function containsHistoryToken(input: unknown): boolean {
  if (!input) return false;
  if (isHistoryGenerator(input)) return true;
  if (Array.isArray(input)) return input.some(containsHistoryToken);
  if (typeof input === "object") {
    return Object.values(input as Record<string, unknown>).some(containsHistoryToken);
  }
  return false;
}

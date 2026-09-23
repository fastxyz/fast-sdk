import type { Availability } from "./reads.js";

export type PreflightState =
  | "eligible"
  | "blocked"
  | "reservation_unresolved"
  | "indeterminate";

export type PreflightInput = Availability | "failed" | null | undefined;

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Fail-closed mirror of the web claim preflight classifier. */
export function classifyPreflight(
  input: PreflightInput,
  expectedNetwork: string,
): PreflightState {
  if (
    input === "failed" ||
    input === null ||
    input === undefined ||
    typeof input !== "object"
  ) {
    return "indeterminate";
  }

  const {
    network,
    available,
    taken,
    skeleton_conflict: conflict,
    reserved,
  } = input as Partial<Availability>;
  if (
    !isBoolean(available) ||
    !isBoolean(conflict) ||
    !isBoolean(reserved) ||
    (taken !== undefined && !isBoolean(taken))
  ) {
    return "indeterminate";
  }
  if (network !== expectedNetwork) return "indeterminate";

  const anyNegative = conflict || reserved || taken === true;
  if (available && anyNegative) return "indeterminate";
  if (conflict || taken === true) return "blocked";
  if (reserved) {
    return taken === false ? "reservation_unresolved" : "indeterminate";
  }
  return available ? "eligible" : "indeterminate";
}

export function mayReachSettlement(state: PreflightState): boolean {
  return state === "eligible";
}

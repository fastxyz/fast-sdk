// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { FrozenOperation, JournalSnapshot, RecoveryJournal } from "../types.js";

function freezeGraph<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object) || ArrayBuffer.isView(object) || object instanceof ArrayBuffer) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    freezeGraph((object as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

/**
 * Detach a journal value from a caller-owned implementation and freeze every
 * plain object in the recovery graph before the value is validated or reused.
 */
export function snapshotJournalSnapshot(snapshot: JournalSnapshot): JournalSnapshot {
  return freezeGraph(structuredClone(snapshot));
}

export function snapshotFrozenOperation(operation: FrozenOperation): FrozenOperation {
  return freezeGraph(structuredClone(operation));
}

export function snapshotRecoveryJournal(journal: RecoveryJournal): RecoveryJournal {
  if (!journal) {
    throw new Error("journal must provide load, save, and withLock capabilities");
  }
  const load = journal.load;
  const save = journal.save;
  const withLock = journal.withLock;
  if (typeof load !== "function" || typeof save !== "function" || typeof withLock !== "function") {
    throw new Error("journal must provide load, save, and withLock capabilities");
  }
  const boundLoad = load.bind(journal);
  const boundSave = save.bind(journal);
  const boundWithLock = withLock.bind(journal);
  return {
    async load(operationId) {
      const snapshot = await boundLoad(operationId);
      return snapshot === null ? null : snapshotJournalSnapshot(snapshot);
    },
    async save(snapshot) {
      await boundSave(snapshotJournalSnapshot(snapshot));
    },
    withLock: boundWithLock,
  };
}

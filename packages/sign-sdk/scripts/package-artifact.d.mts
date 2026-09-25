// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

export const expectedPackageInventory: readonly string[];
export function cleanBuildOutput(root?: string): void;
export function assertPackageInventory(entries: readonly string[]): void;
export function assertPackageContent(files: readonly { path: string; content: string }[]): void;

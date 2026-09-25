// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

export interface ReviewedDependency {
  readonly name: string;
  readonly version: string;
  readonly license: string | null;
  readonly evidence?: string;
}

export const reviewedDependencies: readonly ReviewedDependency[];
export function assertLicenseProvenance(records?: readonly ReviewedDependency[]): void;

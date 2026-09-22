// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The journal suite compiles and spawns real child runtimes. Keep this
    // package to one test file at a time so workspace CI does not starve the
    // independent SDK binders running in parallel Turbo tasks.
    fileParallelism: false,
  },
});

import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: join(homedir(), ".fast", "fast.db"),
  },
});

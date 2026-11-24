/**
 * Vitest global setup – loaded before every test file.
 * Extends the timeout for DB-hitting integration tests.
 */
import { vi } from "vitest";

// Silence noisy console.log in tests unless DEBUG=1
if (!process.env.DEBUG) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
}

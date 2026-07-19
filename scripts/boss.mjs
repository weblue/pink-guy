#!/usr/bin/env node

// Compatibility entry point. New documentation and integrations should use
// `pink`; the legacy command continues to execute the same client.
await import("./pink.mjs");

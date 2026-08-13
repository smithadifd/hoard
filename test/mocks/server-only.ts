// Stand-in for the `server-only` package under Vitest.
//
// The real `server-only/index.js` throws unconditionally on import — Next's
// webpack/turbopack build is what makes that safe, by resolving the package
// to a no-op when compiling for the server and only wiring in the throwing
// version for a client bundle. Vitest has no such split: it's plain Node, so
// without this alias every test that imports a module marked `server-only`
// (transitively or directly) would fail before a single test body runs.
//
// Aliased in vitest.config.ts. Intentionally empty — importing `server-only`
// is a no-op here, matching its behavior in an actual server context.
export {};

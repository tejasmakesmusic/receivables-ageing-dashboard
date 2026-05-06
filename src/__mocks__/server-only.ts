// Stub for "server-only" — allows service files to be imported in Vitest.
// The real package throws at build time if imported outside of a server context.
const serverOnly = {};
export default serverOnly;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeSentry } = await import("./src/lib/sentry");
    await initializeSentry();
  }
}

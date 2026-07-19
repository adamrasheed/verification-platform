process.stdin.once("data", () => {
  process.stderr.write("x".repeat(70 * 1024));
});

#!/usr/bin/env node

// Subcommand: klaudio play <file> [--tts]
if (process.argv[2] === "play") {
  const { handlePlayCommand } = await import("../src/player.js");
  await handlePlayCommand(process.argv.slice(3));
  process.exit(0);
}

// Default: interactive installer UI
const { run } = await import("../src/cli.js");

run().catch((err) => {
  if (err.name === "ExitPromptError") {
    // User pressed Ctrl+C
    console.log("\n  Cancelled.\n");
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

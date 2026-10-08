// Prints the real reason if the server dies during import or startup.
// Railway's healthcheck only says "service unavailable" when nothing is listening.
console.log(
  `boot node ${process.version} port=${process.env.PORT || "(unset)"} data=${process.env.DATA_DIR || "(default)"}`
);
try {
  await import("./index.js");
} catch (err) {
  console.error("backend failed to start");
  console.error(err);
  process.exit(1);
}

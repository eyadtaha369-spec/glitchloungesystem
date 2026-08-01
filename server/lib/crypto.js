const crypto = require("crypto");

// Matches Code.gs's sha256Hex_ exactly (plain SHA-256, hex-encoded) — this
// means migrated account rows work with their EXISTING passwords, no
// re-registration needed.
function sha256Hex_(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

module.exports = { sha256Hex_ };

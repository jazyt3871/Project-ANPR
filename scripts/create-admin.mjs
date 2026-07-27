/**
 * Creates or updates the admin account.
 *
 *   npm run admin                    # create "anpr" with a generated password
 *   npm run admin -- --username bob  # a different name
 *   npm run admin -- --password '…'  # supply the password instead
 *
 * Idempotent in the sense that matters: run it again and the account still
 * exists and is still an admin. It does NOT silently rotate the password —
 * re-running on an existing account without --password leaves the current one
 * alone, because a setup script that quietly invalidates the credentials you
 * already wrote down is worse than one that says nothing changed. Use
 * --reset-password to actually rotate it.
 *
 * The password is printed once, to stdout, and never stored anywhere but as a
 * scrypt hash in the database.
 */

import { randomBytes, randomInt, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const scrypt = promisify(scryptCb);
const prisma = new PrismaClient();

/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}
const has = (name) => args.includes(`--${name}`);

const username = flag("username") ?? "anpr";
const resetPassword = has("reset-password");
const suppliedPassword = flag("password");

/**
 * Six words from a 64-word list plus a number: ~36 bits from the words and ~10
 * more from the digits. Chosen over a random character string because this gets
 * copied off a terminal and typed into a phone, and a passphrase survives that
 * trip intact. Words are picked with randomInt, which is rejection-sampled and
 * therefore unbiased, rather than Math.random.
 */
const WORDS = [
  "amber", "anchor", "atlas", "beacon", "bishop", "bramble", "cactus", "canyon",
  "cedar", "cinder", "compass", "copper", "cobalt", "crimson", "dagger", "delta",
  "dune", "ember", "falcon", "fathom", "flint", "gable", "granite", "harbor",
  "hollow", "indigo", "ivory", "juniper", "kettle", "lantern", "ledger", "lichen",
  "marble", "meadow", "meridian", "mortar", "nectar", "nimbus", "obsidian", "orchard",
  "pewter", "pigment", "quarry", "quartz", "ravine", "rivet", "saffron", "sextant",
  "shale", "sable", "talon", "tundra", "umber", "vellum", "verdant", "vessel",
  "walnut", "willow", "wicket", "yarrow", "zenith", "zephyr", "basalt", "cypress",
];

function generatePassword() {
  const words = Array.from({ length: 6 }, () => WORDS[randomInt(WORDS.length)]);
  return `${words.join("-")}-${randomInt(100, 1000)}`;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/* -------------------------------------------------------------------------- */

async function main() {
  const existing = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
  });

  if (existing && !resetPassword && !suppliedPassword) {
    // Promote in case the row exists as a normal user, but leave the password.
    if (existing.role !== "admin") {
      await prisma.user.update({ where: { id: existing.id }, data: { role: "admin" } });
      console.log(`Existing user "${existing.username}" promoted to admin.`);
    } else {
      console.log(`Admin "${existing.username}" already exists. Password unchanged.`);
      console.log("Use --reset-password to set a new one.");
    }
    return;
  }

  const password = suppliedPassword ?? generatePassword();
  if (suppliedPassword && suppliedPassword.length < 12) {
    console.error("error: --password must be at least 12 characters.");
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, role: "admin" },
    });
  } else {
    await prisma.user.create({ data: { username, passwordHash, role: "admin" } });
  }

  const action = existing ? "Password reset for admin" : "Created admin";
  console.log("");
  console.log("  ---------------------------------------------------------");
  console.log(`  ${action} "${username}"`);
  console.log("");
  console.log(`    username:  ${username}`);
  if (!suppliedPassword) console.log(`    password:  ${password}`);
  console.log("");
  console.log("  Save this now. It is stored only as a hash and cannot be");
  console.log("  recovered -- only reset with: npm run admin -- --reset-password");
  console.log("  ---------------------------------------------------------");
  console.log("");
}

main()
  .catch((err) => {
    console.error("Failed to create the admin account:", err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

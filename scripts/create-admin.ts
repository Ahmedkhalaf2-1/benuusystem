/**
 * Creates the first OWNER_ADMIN account.
 *
 *   npm run admin:create
 *
 * - Prompts for name, email and password (password input is hidden).
 * - The password is never accepted as a command-line flag or env variable,
 *   so it never ends up in shell history, process lists or source control.
 * - Refuses to run if an owner account already exists.
 *
 * Non-interactive use (e.g. provisioning): pipe the answers on stdin, one per
 * line — name, email, password, password confirmation — from a file you delete
 * afterwards. Never put the password itself on the command line.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { getPrisma } from "@/lib/db/prisma";
import { isAppError } from "@/lib/errors";
import {
  emailSchema,
  newPasswordSchema,
  userNameSchema,
} from "@/lib/validations/auth";
import {
  createFirstOwnerAdmin,
  ownerAdminExists,
} from "@/server/services/admin-bootstrap-service";

const interactive = Boolean(stdin.isTTY);

/** Lines from stdin when it is piped (non-interactive mode). */
const pipedLines: AsyncIterator<string> | null = interactive
  ? null
  : createInterface({ input: stdin, terminal: false })[Symbol.asyncIterator]();

async function readPipedLine(label: string): Promise<string> {
  const next = await pipedLines!.next();
  if (next.done) throw new Error(`Missing input for: ${label}`);
  return next.value;
}

async function ask(question: string): Promise<string> {
  if (!interactive) return readPipedLine(question);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await new Promise<string>((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it (raw mode). */
async function askHidden(question: string): Promise<string> {
  if (!interactive) return readPipedLine(question);
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<string>((resolve) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(false);
          stdout.write("\nCancelled.\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

/** Asks until the schema accepts the answer (interactive) or fails (piped). */
async function askValid<T>(
  question: string,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } },
  hidden = false,
): Promise<T> {
  for (;;) {
    const answer = hidden ? await askHidden(question) : await ask(question);
    const parsed = schema.safeParse(answer);
    if (parsed.success) return parsed.data;
    const message = parsed.error.issues[0]?.message ?? "Invalid value";
    if (!interactive) throw new Error(message);
    console.log(`  ✗ ${message}`);
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: npm run admin:create\nCreates the first OWNER_ADMIN account interactively.");
    return;
  }
  if (process.argv.slice(2).some((arg) => arg.startsWith("--password"))) {
    throw new Error("Passing a password as an argument is not supported. Run the command and type it when asked.");
  }

  const db = getPrisma();
  try {
    console.log("\nBenuuprint ERP — create the owner/admin account\n");

    if (await ownerAdminExists(db)) {
      console.error("An OWNER_ADMIN account already exists. Nothing was changed.");
      process.exitCode = 1;
      return;
    }

    const name = await askValid("Full name: ", userNameSchema);
    const email = await askValid("Email: ", emailSchema);

    let password: string;
    for (;;) {
      password = await askValid("Password (min 8 characters, hidden): ", newPasswordSchema, true);
      const confirmation = await askHidden("Repeat password: ");
      if (confirmation === password) break;
      if (!interactive) throw new Error("Passwords do not match.");
      console.log("  ✗ Passwords do not match. Try again.");
    }

    const user = await createFirstOwnerAdmin(db, { name, email, password });
    console.log(`\n✓ Owner account created for ${user.email}. You can now sign in.\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (isAppError(error)) {
    console.error(`\n✗ ${error.message}`);
    if (error.fieldErrors) console.error(error.fieldErrors);
  } else {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});

/**
 * Account administration on the server shell.
 *
 *   npm run users -- list
 *   npm run users -- create-staff        (asks for name, email, password)
 *   npm run users -- reset-password <email>
 *   npm run users -- deactivate <email>
 *   npm run users -- activate <email>
 *   npm run users -- revoke-sessions <email>
 *
 * Passwords are typed at a hidden prompt (or piped on stdin, one per line);
 * they are never accepted as arguments, so they never reach shell history.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { getPrisma } from "@/lib/db/prisma";
import { isAppError } from "@/lib/errors";
import {
  createStaffUser,
  listUsers,
  resetUserPassword,
  revokeUserSessions,
  setUserActive,
} from "@/server/services/user-admin-service";

const USAGE = `Usage: npm run users -- <command> [email]
  list                     all accounts, role, status, open sessions
  create-staff             new STAFF account (prompts)
  reset-password <email>   new password; signs the user out everywhere
  deactivate <email>       blocks sign-in and signs the user out everywhere
  activate <email>         allows sign-in again
  revoke-sessions <email>  signs the user out everywhere`;

const interactive = Boolean(stdin.isTTY);
const piped = interactive ? null : createInterface({ input: stdin, terminal: false })[Symbol.asyncIterator]();

async function ask(question: string): Promise<string> {
  if (piped) {
    const next = await piped.next();
    if (next.done) throw new Error(`Missing input for: ${question}`);
    return next.value;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await new Promise<string>((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

async function askHidden(question: string): Promise<string> {
  if (piped) return ask(question);
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
          stdin.setRawMode(false);
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function askNewPassword(): Promise<string> {
  const password = await askHidden("New password (min 8 characters, hidden): ");
  const confirmation = await askHidden("Repeat password: ");
  if (password !== confirmation) throw new Error("Passwords do not match. Nothing was changed.");
  return password;
}

async function main() {
  const [command, email] = process.argv.slice(2);
  if (process.argv.slice(2).some((a) => a.startsWith("--password"))) {
    throw new Error("Passwords are never accepted as arguments. Run the command and type it when asked.");
  }
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  const needsEmail = ["reset-password", "deactivate", "activate", "revoke-sessions"].includes(command);
  if (needsEmail && !email) throw new Error(`"${command}" needs an email.\n\n${USAGE}`);

  const db = getPrisma();
  try {
    switch (command) {
      case "list": {
        const users = await listUsers(db);
        console.table(users.map((u) => ({ email: u.email, name: u.name, role: u.role, active: u.isActive, sessions: u.sessions })));
        break;
      }
      case "create-staff": {
        const name = await ask("Full name: ");
        const userEmail = await ask("Email: ");
        const user = await createStaffUser(db, { name, email: userEmail, password: await askNewPassword() });
        console.log(`✓ Staff account created for ${user.email}.`);
        break;
      }
      case "reset-password": {
        const r = await resetUserPassword(db, { email: email!, password: await askNewPassword() });
        console.log(`✓ Password changed for ${r.user.email}; ${r.sessionsRevoked} session(s) signed out.`);
        break;
      }
      case "deactivate":
      case "activate": {
        const r = await setUserActive(db, { email: email!, active: command === "activate" });
        console.log(`✓ ${r.user.email} is now ${r.user.isActive ? "active" : "deactivated"}${r.sessionsRevoked ? `; ${r.sessionsRevoked} session(s) signed out` : ""}.`);
        break;
      }
      case "revoke-sessions": {
        const r = await revokeUserSessions(db, email!);
        console.log(`✓ ${r.sessionsRevoked} session(s) signed out for ${r.user.email}.`);
        break;
      }
      default:
        throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`✗ ${isAppError(error) || error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

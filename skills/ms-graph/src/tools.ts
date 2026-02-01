#!/usr/bin/env node
/**
 * CLI entry point for ms-graph skill tools.
 *
 * Usage: node tools.js <command> [args...]
 *
 * Commands:
 *   auth-start              Start device code authentication
 *   auth-status             Check authentication status
 *   auth-clear              Clear cached tokens
 *   mail-list [options]     List emails
 *   mail-get <id>           Get a single email
 *   mail-search <query>     Search emails
 *   mail-send               Send an email (reads JSON from stdin)
 *   mail-export <id> [dir]  Export email as .eml
 *   mail-folders            List mail folders
 */

import {
  startDeviceCodeAuth,
  getAccessTokenSilent,
  getAccountInfo,
  clearTokens,
} from "./auth";
import {
  listMessages,
  getMessage,
  searchMessages,
  sendMail,
  exportAsEml,
  bulkExportEml,
  listFolders,
  getAttachments,
} from "./mail";

const [, , command, ...args] = process.argv;

function usage(): never {
  console.error(`Usage: node tools.js <command> [args...]

Commands:
  auth-start              Start device code authentication
  auth-status             Check authentication status
  auth-clear              Clear cached tokens
  mail-list [options]     List emails (--folder, --top, --skip)
  mail-get <id>           Get a single email by ID
  mail-search <query>     Search emails using KQL
  mail-send               Send email (reads JSON from stdin)
  mail-export <id> [dir]  Export email(s) as .eml
  mail-folders            List mail folders
  mail-attachments <id>   List attachments for a message`);
  process.exit(1);
}

/** Parse --key value pairs from args. */
function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

/** Read all of stdin as a string. */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  if (!command) usage();

  switch (command) {
    case "auth-start": {
      const { deviceCodeInfo, authPromise } = await startDeviceCodeAuth();
      // Output the device code info immediately so Rook can show it to the user
      console.log(JSON.stringify(deviceCodeInfo, null, 2));
      // Wait for user to complete auth
      const result = await authPromise;
      if (result) {
        console.log(
          JSON.stringify(
            {
              status: "authenticated",
              account: result.account?.username,
              expiresOn: result.expiresOn?.toISOString(),
            },
            null,
            2
          )
        );
      }
      break;
    }

    case "auth-status": {
      const account = await getAccountInfo();
      if (account) {
        const tokenValid = (await getAccessTokenSilent()) !== null;
        console.log(
          JSON.stringify(
            {
              authenticated: true,
              account: account.username,
              homeAccountId: account.homeAccountId,
              tokenValid,
            },
            null,
            2
          )
        );
      } else {
        console.log(JSON.stringify({ authenticated: false }, null, 2));
      }
      break;
    }

    case "auth-clear": {
      await clearTokens();
      console.log(JSON.stringify({ status: "cleared" }, null, 2));
      break;
    }

    case "mail-folders": {
      const folders = await listFolders();
      console.log(JSON.stringify(folders, null, 2));
      break;
    }

    case "mail-list": {
      const flags = parseFlags(args);
      const result = await listMessages({
        folder: flags.folder || "inbox",
        top: flags.top ? parseInt(flags.top, 10) : 25,
        skip: flags.skip ? parseInt(flags.skip, 10) : 0,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "mail-get": {
      const messageId = args[0];
      if (!messageId) {
        console.error("Usage: mail-get <message-id>");
        process.exit(1);
      }
      const message = await getMessage(messageId);
      console.log(JSON.stringify(message, null, 2));
      break;
    }

    case "mail-search": {
      const query = args.join(" ");
      if (!query) {
        console.error("Usage: mail-search <query>");
        process.exit(1);
      }
      const flags = parseFlags(args);
      const messages = await searchMessages(query, {
        top: flags.top ? parseInt(flags.top, 10) : 25,
      });
      console.log(JSON.stringify(messages, null, 2));
      break;
    }

    case "mail-send": {
      const input = await readStdin();
      const payload = JSON.parse(input);
      await sendMail(payload);
      console.log(JSON.stringify({ status: "sent" }, null, 2));
      break;
    }

    case "mail-export": {
      const id = args[0];
      if (!id) {
        console.error("Usage: mail-export <message-id> [output-dir]");
        process.exit(1);
      }
      const outputDir = args[1];
      if (outputDir) {
        // Bulk export mode: id is comma-separated
        const ids = id.split(",");
        const paths = await bulkExportEml(ids, outputDir);
        console.log(JSON.stringify({ exported: paths }, null, 2));
      } else {
        // Single export to stdout
        const eml = await exportAsEml(id);
        process.stdout.write(eml);
      }
      break;
    }

    case "mail-attachments": {
      const msgId = args[0];
      if (!msgId) {
        console.error("Usage: mail-attachments <message-id>");
        process.exit(1);
      }
      const attachments = await getAttachments(msgId);
      console.log(JSON.stringify(attachments, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

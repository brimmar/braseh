import { join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { parseArgv } from "./cli-parse";
import { brasehApply } from "./commands/apply";
import { brasehCheck } from "./commands/check";
import { brasehDoctor } from "./commands/doctor";
import { brasehInit } from "./commands/init";
import { brasehPrepare } from "./commands/prepare";
import {
  brasehSecretGet,
  brasehSecretList,
  brasehSecretRemove,
  brasehSecretSet,
} from "./commands/secrets";
import { formatError } from "./core/errors";
import { getHelpText } from "./help";
import { CLI_VERSION } from "./version";

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    try {
      const request = parseArgv(args);

      if (request.kind === "help") {
        process.stdout.write(
          `${getHelpText(request.command, request.subcommand)}\n`,
        );
        return;
      }

      if (request.kind === "version") {
        if (request.json) {
          process.stdout.write(`${JSON.stringify({ version: CLI_VERSION }, null, 2)}\n`);
        } else {
          process.stdout.write(`${CLI_VERSION}\n`);
        }
        return;
      }

      if (request.kind === "init") {
        p.log.step(`Initializing project at ${request.projectDir}...`);
        await brasehInit(request.projectDir, { force: request.force });
        p.log.success("Project initialized successfully!");
        p.note(
          `Project created at ${request.projectDir}\nEdit ${join(request.projectDir, "braseh.ts")} to get started.`,
          "next steps",
        );
      } else if (request.kind === "prepare") {
        p.log.step(`Preparing editor types at ${request.dir}...`);
        await brasehPrepare(request.dir);
        p.log.success("Editor types prepared.");
      } else if (request.kind === "check") {
        const result = await brasehCheck(request.configPath, {
          json: request.json,
        });
        if (request.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        }
      } else if (request.kind === "doctor") {
        const result = await brasehDoctor({ json: request.json });
        if (request.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        }
      } else if (request.kind === "apply") {
        const result = await brasehApply(request.configPath, {
          dryRun: request.dryRun,
          yes: request.yes,
          verbose: request.verbose,
          json: request.json,
        });
        if (request.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        }
      } else if (request.kind === "secrets-get") {
        await brasehSecretGet(request.name);
      } else if (request.kind === "secrets-set") {
        await brasehSecretSet(request.name, request.value);
      } else if (request.kind === "secrets-list") {
        const result = await brasehSecretList({ json: request.json });
        if (request.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        }
      } else if (request.kind === "secrets-remove") {
        await brasehSecretRemove(request.name);
      }
    } catch (error) {
      const isJson = args.includes("--json");
      const formatted = formatError(error);
      if (isJson) {
        process.stdout.write(
          `${JSON.stringify(
            {
              success: false,
              error: {
                title: formatted.title,
                message: formatted.message,
                hint: formatted.hint,
              },
            },
            null,
            2,
          )}\n`,
        );
      } else {
        p.log.error(pc.red(`${formatted.title}: ${formatted.message}`));
        if (formatted.hint) {
          p.note(formatted.hint, "suggested fix");
        }
      }
      process.exit(1);
    }
    return;
  }

  p.intro(pc.cyan(" braseh "));

  const command = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "init", label: "Initialize a new project", hint: "braseh init" },
      {
        value: "prepare",
        label: "Prepare editor types",
        hint: "braseh prepare",
      },
      { value: "check", label: "Check configuration", hint: "braseh check" },
      { value: "doctor", label: "System Diagnostics", hint: "braseh doctor" },
      { value: "apply", label: "Apply configuration", hint: "braseh apply" },
      { value: "secrets", label: "Manage secrets", hint: "braseh secrets" },
      { value: "exit", label: "Exit" },
    ],
  });

  if (p.isCancel(command) || command === "exit") {
    p.outro("Goodbye!");
    process.exit(0);
  }

  try {
    if (command === "init") {
      const projectDir = await p.text({
        message: "Where should the project be initialized?",
        placeholder: "./my-dotfiles",
        defaultValue: "./my-dotfiles",
      });

      if (p.isCancel(projectDir)) {
        p.outro("Cancelled.");
        process.exit(0);
      }

      const s = p.spinner();
      s.start("Initializing project...");
      await brasehInit(projectDir);
      s.stop("Project initialized successfully!");
      p.note(
        `Project created at ${projectDir}\nEdit ${join(projectDir, "braseh.ts")} to get started.`,
        "next steps",
      );
    } else if (command === "prepare") {
      await brasehPrepare();
    } else if (command === "check") {
      const configPath = await p.text({
        message: "Path to braseh.ts?",
        placeholder: "./braseh.ts",
        defaultValue: "./braseh.ts",
      });

      if (p.isCancel(configPath)) {
        p.outro("Cancelled.");
        process.exit(0);
      }

      await brasehCheck(configPath);
    } else if (command === "doctor") {
      await brasehDoctor();
    } else if (command === "apply") {
      const configPath = await p.text({
        message: "Path to braseh.ts?",
        placeholder: "./braseh.ts",
        defaultValue: "./braseh.ts",
      });

      if (p.isCancel(configPath)) {
        p.outro("Cancelled.");
        process.exit(0);
      }

      const dryRun = await p.confirm({
        message:
          "Do you want to run in Dry Run mode? (No changes will be made)",
        initialValue: true,
      });

      if (p.isCancel(dryRun)) {
        p.outro("Cancelled.");
        process.exit(0);
      }

      await brasehApply(configPath, { dryRun: dryRun as boolean });
    } else if (command === "secrets") {
      const secretAction = await p.select({
        message: "Secret management:",
        options: [
          { value: "get", label: "Get a secret value" },
          { value: "set", label: "Set a secret" },
          { value: "list", label: "List secrets" },
          { value: "remove", label: "Remove a secret" },
        ],
      });

      if (p.isCancel(secretAction)) {
        p.outro("Cancelled.");
        process.exit(0);
      }

      if (secretAction === "get") {
        const name = await p.text({
          message: "Secret name (e.g. GITHUB_TOKEN):",
        });
        if (p.isCancel(name) || !name) return;
        await brasehSecretGet(name);
      } else if (secretAction === "set") {
        const name = await p.text({
          message: "Secret name (e.g. GITHUB_TOKEN):",
        });
        if (p.isCancel(name) || !name) return;

        const value = await p.password({ message: "Secret value:" });
        if (p.isCancel(value) || !value) return;

        await brasehSecretSet(name, value);
      } else if (secretAction === "list") {
        await brasehSecretList();
      } else if (secretAction === "remove") {
        const name = await p.text({ message: "Secret name to remove:" });
        if (p.isCancel(name) || !name) return;
        await brasehSecretRemove(name);
      }
    }
  } catch (error) {
    const formatted = formatError(error);
    p.log.error(pc.red(`${formatted.title}: ${formatted.message}`));
    if (formatted.hint) {
      p.note(formatted.hint, "suggested fix");
    }
  }

  p.outro(pc.green("Done!"));
}

main().catch(console.error);

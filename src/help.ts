export const GLOBAL_HELP = `braseh - Declarative dotfiles management with TypeScript

Usage:
  braseh [command] [options]
  braseh [options]

Commands:
  init [dir]                     Initialize a new braseh configuration project
  prepare [dir]                  Refresh TypeScript editor definitions in .braseh/types
  check [path]                   Validate a braseh.ts configuration without applying
  apply [path]                   Apply system configuration (packages, files, symlinks)
  doctor                         Run system diagnostics and verify required tools
  secrets <action>               Manage encrypted secrets vault (.braseh/vault)

Options:
  -v, --version                  Print CLI version
  -h, --help                     Show help for braseh or a specific command

Run 'braseh <command> --help' for more information on a specific command.`;

export const INIT_HELP = `braseh init - Initialize a new braseh configuration project

Usage:
  braseh init [dir] [options]

Arguments:
  dir                            Target directory (default: ./my-dotfiles)

Options:
  --force                        Overwrite existing configuration files if present
  -h, --help                     Show this help message

Examples:
  braseh init
  braseh init ~/dotfiles
  braseh init --force .`;

export const PREPARE_HELP = `braseh prepare - Refresh TypeScript editor definitions and type declarations

Usage:
  braseh prepare [dir] [options]

Arguments:
  dir                            Project root containing tsconfig.json (default: current directory)

Options:
  -h, --help                     Show this help message

Description:
  Generates and refreshes .braseh/types/index.d.ts so your editor
  provides full autocomplete and type checking for braseh resources.
  Run this after upgrading the braseh CLI.

Examples:
  braseh prepare
  braseh prepare ~/dotfiles`;

export const CHECK_HELP = `braseh check - Validate a configuration file without executing side effects

Usage:
  braseh check [path] [options]

Arguments:
  path                           Path to the configuration file (default: ./braseh.ts)

Options:
  --json                         Output validation report as structured JSON
  -h, --help                     Show this help message

Description:
  Loads the configuration, builds the dependency graph, verifies secret
  references exist in .braseh/vault, and checks executable prerequisites.

Examples:
  braseh check
  braseh check ./braseh.ts
  braseh check --json`;

export const APPLY_HELP = `braseh apply - Apply declarative system configurations to the local machine

Usage:
  braseh apply [path] [options]

Arguments:
  path                           Path to braseh configuration file or repository shorthand
                                 (e.g., ./braseh.ts, ~/dotfiles, or user/repo) (default: ./braseh.ts)

Options:
  --dry-run                      Preview planned changes without modifying the system
  -y, --yes                      Skip interactive confirmation prompt
  -v, --verbose                  Show detailed command execution and output
  --json                         Output execution summary and resource results as JSON
  -h, --help                     Show this help message

Description:
  Evaluates the configuration graph and reconciles system state in dependency order.
  Tracks state in ~/.braseh/state.json to detect additions, changes, and deletions.
  Each applied resource reports its execution duration on the right.

Examples:
  braseh apply --dry-run
  braseh apply -y
  braseh apply ./braseh.ts --verbose
  braseh apply --json
  braseh apply brimmar/dotfiles -y`;

export const DOCTOR_HELP = `braseh doctor - Run system diagnostics and verify tool prerequisites

Usage:
  braseh doctor [options]

Options:
  --json                         Output diagnostic results as structured JSON
  -h, --help                     Show this help message

Description:
  Checks OS version, kernel release, write permissions in the working directory,
  and verifies availability of core tools (bun, node, npm, git, brew, apt-get).

Examples:
  braseh doctor
  braseh doctor --json`;

export const SECRETS_HELP = `braseh secrets - Manage encrypted credentials and tokens in .braseh/vault

Usage:
  braseh secrets <action> [arguments] [options]

Commands:
  get <name>                     Retrieve a secret value from the vault
  set <name> <value>             Store an encrypted secret in the vault
  list [--json]                  List all secret names stored in the vault
  remove <name>                  Delete a secret from the vault

Options:
  -h, --help                     Show this help message

Description:
  Secrets are encrypted with AES-256-GCM using the key in ~/.braseh_key,
  ~/.braseh-key, ~/.vault-pass, or the BRASEH_KEY environment variable.

Examples:
  braseh secrets list
  braseh secrets list --json
  braseh secrets get ssh_private_key
  braseh secrets set API_KEY "secret-value"
  braseh secrets remove API_KEY

Run 'braseh secrets <action> --help' for details on a specific action.`;

export const SECRETS_GET_HELP = `braseh secrets get - Retrieve a secret value from the vault

Usage:
  braseh secrets get <name>

Arguments:
  name                           Name of the secret to retrieve

Options:
  -h, --help                     Show this help message

Examples:
  braseh secrets get ssh_private_key`;

export const SECRETS_SET_HELP = `braseh secrets set - Store an encrypted secret in the vault

Usage:
  braseh secrets set <name> <value>

Arguments:
  name                           Name of the secret
  value                          Secret value to encrypt and store

Options:
  -h, --help                     Show this help message

Examples:
  braseh secrets set GH_TOKEN "ghp_xxxx"
  braseh secrets set API_KEY "sk-xxxx"`;

export const SECRETS_LIST_HELP = `braseh secrets list - List all secret names stored in the vault

Usage:
  braseh secrets list [options]

Options:
  --json                         Output secret names as structured JSON
  -h, --help                     Show this help message

Examples:
  braseh secrets list
  braseh secrets list --json`;

export const SECRETS_REMOVE_HELP = `braseh secrets remove - Delete a secret from the vault

Usage:
  braseh secrets remove <name>

Arguments:
  name                           Name of the secret to delete

Options:
  -h, --help                     Show this help message

Examples:
  braseh secrets remove API_KEY`;

export function getHelpText(command?: string, subcommand?: string): string {
  if (!command) {
    return GLOBAL_HELP;
  }

  switch (command) {
    case "init":
      return INIT_HELP;
    case "prepare":
      return PREPARE_HELP;
    case "check":
      return CHECK_HELP;
    case "apply":
      return APPLY_HELP;
    case "doctor":
      return DOCTOR_HELP;
    case "secrets":
      if (subcommand) {
        switch (subcommand) {
          case "get":
            return SECRETS_GET_HELP;
          case "set":
            return SECRETS_SET_HELP;
          case "list":
            return SECRETS_LIST_HELP;
          case "remove":
            return SECRETS_REMOVE_HELP;
        }
      }
      return SECRETS_HELP;
    default:
      return GLOBAL_HELP;
  }
}

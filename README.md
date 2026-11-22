# braseh

[![CI](https://github.com/brimmar/braseh/actions/workflows/ci.yml/badge.svg)](https://github.com/brimmar/braseh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

braseh is TypeScript for one machine. You declare packages, files, links, services, and the rest of localhost in a `braseh.ts` file. One binary applies it. `braseh init` writes editor types next to that file, so completions work without an npm install in the project.

## Install

```bash
curl -fsSL https://github.com/brimmar/braseh/raw/main/scripts/install.sh | bash
```

The same darwin and linux binaries (x64 and arm64) are on [GitHub Releases](https://github.com/brimmar/braseh/releases).

## Quick start

```bash
braseh init ./my-dotfiles
cd ./my-dotfiles
# edit braseh.ts. Completions work.
braseh check
braseh apply --dry-run
braseh apply
```

`init` writes a project that imports from `'braseh'`.

```ts
import { pkg, file, onPlatform, onDistro } from 'braseh';

export default () => {
  pkg('git');

  onPlatform('darwin', () => {
    pkg('iterm2');
  });

  onDistro(['ubuntu', 'debian'], () => {
    pkg('build-essential');
  });

  file('~/.gitconfig', {
    content: '[user]\n\tname = Ada\n',
  });
};
```

## Prepare after a CLI upgrade

After you upgrade the `braseh` binary, run `braseh prepare` in the project. That refreshes `.braseh/types` so the editor matches the CLI you just installed. `init` already runs this once.

```bash
braseh prepare
```

## Commands

```text
braseh init [dir]
braseh prepare [dir]
braseh check [path] [--yes]
braseh apply [path] [--dry-run] [--yes]
braseh doctor
braseh secrets set NAME [value]
braseh secrets list
braseh secrets remove NAME
```

`braseh --help` and `braseh -h` print the same list. No arguments opens the interactive menu.

`apply` keeps state in `.braseh/state.json` next to the config file, so it does not matter which directory you run it from. When a resource leaves the config, the next apply destroys it. Packages, users, groups and services that were already on the machine before braseh first applied them are left in place and only dropped from state.

`check` and `apply` with a `user/repo` or URL ask before loading it, because loading a config runs its code.

## API reference

Helpers return `ResourceHandle`. Pass those handles in `dependsOn`. Shared props on every resource helper:

- `dependsOn?: ResourceHandle[]`
- `become?: boolean | string` (`true` is sudo, a string is that user)
- `retries?: number`
- `retryDelay?: number` (seconds)

Paths accept `~` for the home directory.

### pkg

```ts
pkg(name: string, props?: PackageProps): ResourceHandle
```

Installs a package. Props: `manager?: 'brew' | 'apt' | 'npm' | 'pacman' | 'bun' | 'cargo' | 'pip'`, `version?: string`, `state?: 'present' | 'absent'`. Omit `manager` and the CLI infers one from the OS and distro. `state: 'absent'` uninstalls the package if it is installed.

```ts
import { pkg } from 'braseh';

pkg('git');
pkg('ripgrep', { manager: 'brew' });
```

### file

```ts
file(path: string, props: FileProps): ResourceHandle
```

Writes a file. Props: `content: string | SecretToken` (required), `vars?: Record<string, unknown>` (Mustache), `mode?: number`, `uid?: number`, `gid?: number`.

`vars` values are inserted as-is, without HTML escaping, and may be `secret('NAME')`. `mode` is applied before the content is written.

```ts
import { file } from 'braseh';

file('~/.gitconfig', {
  content: '[user]\n\tname = Ada\n',
  mode: 0o644,
});
```

### link

```ts
link(path: string, source: string, props?: LinkProps): ResourceHandle
```

Creates a symlink at `path` pointing at `source`. Props: `force?: boolean`.

An existing symlink is replaced. A real file or directory at `path` makes apply fail, so your data is never deleted by surprise. Pass `force: true` to delete it and link in its place.

```ts
import { link } from 'braseh';

link('~/.config/nvim', '~/dotfiles/nvim');
```

### dir

```ts
dir(path: string, props?: DirectoryProps): ResourceHandle
```

Creates a directory. Props: `mode?: number`, `uid?: number`, `gid?: number`.

```ts
import { dir } from 'braseh';

dir('~/.config/myapp');
```

### script

```ts
script(run: string, props?: ScriptProps): ResourceHandle
```

Runs a shell command. The resource id is a hash of `run` plus stable props (`workingDir`, `unless`, `onlyIf`, `become`, `environment`). Props: `unless?: string` (skip when this command exits 0), `onlyIf?: string` (run only when this command exits 0), `workingDir?: string`, `environment?: Record<string, string>`.

```ts
import { script } from 'braseh';

script('jq --version > /tmp/jq-version.txt', {
  unless: 'test -f /tmp/jq-version.txt',
  workingDir: '/tmp',
});
```

### remoteFile

```ts
remoteFile(path: string, props: RemoteFileProps): ResourceHandle
```

Downloads a URL to `path`. Props: `url: string` (required), `sha256?: string`, `mode?: number`, `uid?: number`, `gid?: number`.

```ts
import { remoteFile } from 'braseh';

remoteFile('~/.local/bin/tool.sh', {
  url: 'https://example.com/tool.sh',
  mode: 0o755,
});
```

### git

```ts
git(url: string, props: GitProps): ResourceHandle
```

Clones a repository. Props: `dest: string` (required), `branch?: string`, `depth?: number`, `recursive?: boolean`, `sparse?: string[]`.

```ts
import { git } from 'braseh';

git('https://github.com/brimmar/braseh.git', {
  dest: '/tmp/braseh',
  depth: 1,
});
```

### lineInFile

```ts
lineInFile(path: string, line: string, props?: LineInFileProps): ResourceHandle
```

Adds or removes a line. Props: `regexp?: string | RegExp`, `state?: 'present' | 'absent'`.

```ts
import { lineInFile } from 'braseh';

lineInFile('~/.bashrc', 'export BRASEH_MANAGED=1');
```

### service

```ts
service(name: string, props?: ServiceProps): ResourceHandle
```

Manages a systemd unit. Linux only. Apply fails on other operating systems. Props: `state?: 'started' | 'stopped' | 'restarted' | 'reloaded'`, `enabled?: boolean`.

```ts
import { service } from 'braseh';

service('sshd', { state: 'started', enabled: true });
```

### user

```ts
user(name: string, props?: UserProps): ResourceHandle
```

Manages a login account. Props: `uid?: number`, `gid?: number | string`, `groups?: string[]`, `shell?: string`, `home?: string`, `createHome?: boolean`, `state?: 'present' | 'absent'`.

```ts
import { user } from 'braseh';

user('deploy', { shell: '/bin/bash', createHome: true });
```

### group

```ts
group(name: string, props?: GroupProps): ResourceHandle
```

Manages a system group. Props: `gid?: number`, `state?: 'present' | 'absent'`.

```ts
import { group } from 'braseh';

group('docker');
```

### aptRepository

```ts
aptRepository(name: string, props: AptRepositoryProps): ResourceHandle
```

Adds or removes an apt source. Debian and Ubuntu only. Props: `uri: string`, `distribution: string`, `components: string[]`, `key?: string`, `state?: 'present' | 'absent'`.

```ts
import { aptRepository } from 'braseh';

aptRepository('nodejs', {
  uri: 'https://deb.nodesource.com/node_22.x',
  distribution: 'nodistro',
  components: ['main'],
});
```

### unarchive

```ts
unarchive(id: string, props: UnarchiveProps): ResourceHandle
```

Extracts an archive. `id` is the stable resource id fragment (`unarchive:${id}`). Props: `src: string`, `dest: string`, `stripComponents?: number`, `mode?: number`, `uid?: number`, `gid?: number`.

```ts
import { unarchive } from 'braseh';

unarchive('tools', { src: '~/tools.tar.gz', dest: '~/.local/opt/tools' });
```

### secret

```ts
secret(name: string): SecretToken
```

Returns a token for a named secret. Use it as `file` content. Values come from `braseh secrets`.

```ts
import { file, secret } from 'braseh';

file('~/.npmrc', { content: secret('NPM_TOKEN') });
```

### onPlatform

```ts
onPlatform(os: OS | OS[], callback: () => void | Promise<void>): void
```

Runs `callback` when the current OS matches. `OS` is `'linux' | 'darwin' | 'win32' | 'freebsd' | 'openbsd' | 'aix' | 'sunos' | 'android'`. Declare resources with the same global helpers inside the callback.

```ts
import { pkg, onPlatform } from 'braseh';

onPlatform('darwin', () => {
  pkg('iterm2');
});

onPlatform('linux', () => {
  pkg('ripgrep');
});
```

### onDistro

```ts
onDistro(distro: Distro | Distro[], callback: () => void | Promise<void>): void
```

Runs `callback` when the current Linux distro matches. Matching uses `/etc/os-release` `ID` and `ID_LIKE`, so Pop!_OS (`ID=pop`) matches `pop` and `ubuntu`. Unknown distros never match. `Distro` is `'ubuntu' | 'debian' | 'pop' | 'arch' | 'fedora' | 'centos' | 'rhel' | 'alpine'`.

```ts
import { pkg, onDistro } from 'braseh';

onDistro(['ubuntu', 'debian'], () => {
  pkg('build-essential');
});
```

## Secrets

```bash
braseh secrets set NAME            # prompts for the value
printf '%s' "$TOKEN" | braseh secrets set NAME
braseh secrets list
braseh secrets remove NAME
```

A value given as a third argument still works, but it lands in shell history and `ps`.

Values are encrypted at rest. The master key lives in `~/.braseh_key`. Reference a secret from config with `secret('NAME')`.

## Comparison

| | braseh | chezmoi | pyinfra | Nix |
|---|---|---|---|---|
| Config language | TypeScript | templates / TOML | Python | Nix |
| Install | one binary | one binary | Python | Nix |
| Editor types | yes (`.d.ts`) | no | yes (Python) | via nixd |
| Scope | localhost machine state | home files | localhost + SSH | whole system |
| Converges live state | yes | files | yes | rebuild |

## Non-goals

braseh is not a fleet tool. It does not SSH into other hosts.

It is not bit-for-bit reproducible. Apply converges live state on this machine. It is not a Nix rebuild.

It is not a symlink-only dotfile manager. Packages, files, services, users, and the rest of the API are in scope.

## License

MIT © [brimmar](https://github.com/brimmar)

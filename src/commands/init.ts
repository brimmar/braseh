import { exists, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrasehError } from '../core/errors';
import { brasehPrepare } from './prepare';

const GITIGNORE = `node_modules
.braseh/state.json
.braseh/secrets.json
`;

const BRASEH_TEMPLATE = `import { pkg, file, onPlatform, onDistro } from 'braseh';

export default () => {
  pkg('git');
  pkg('neovim');

  onPlatform('darwin', () => {
    pkg('iterm2');
  });

  onPlatform('linux', () => {
    pkg('tilix');
  });

  onDistro('ubuntu', () => {
    pkg('build-essential');
  });

  file('~/.gitconfig', {
    content: ${'`'}[user]
  name = My Name
  email = my@email.com${'`'},
  });
};
`;

export function parseInitArgs(args: string[]): { projectDir: string; force: boolean } {
  const force = args.includes('--force');
  const projectDir = args.find((arg) => !arg.startsWith('-')) || './my-dotfiles';
  return { projectDir, force };
}

export async function brasehInit(projectDir: string, options: { force?: boolean } = {}) {
  await mkdir(projectDir, { recursive: true });
  const configPath = join(projectDir, 'braseh.ts');
  if (!options.force && (await exists(configPath))) {
    throw new BrasehError(
      `Refusing to overwrite existing ${configPath}`,
      'Pass --force to re-initialize, or use a different directory.',
    );
  }
  await writeFile(configPath, BRASEH_TEMPLATE);
  const gitignorePath = join(projectDir, '.gitignore');
  if (!(await exists(gitignorePath))) {
    await writeFile(gitignorePath, GITIGNORE);
  }
  await brasehPrepare(projectDir);
}

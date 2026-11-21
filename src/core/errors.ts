import pc from 'picocolors';

export class BrasehError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = 'BrasehError';
  }
}

export function formatError(error: unknown): { title: string; message: string; hint?: string } {
  if (error instanceof BrasehError) {
    return {
      title: 'Operational Error',
      message: error.message,
      hint: error.hint,
    };
  }

  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes('Secret not found')) {
    return {
      title: 'Missing Secret',
      message: msg,
      hint: 'Use "braseh secrets set <name>" to add the missing secret.',
    };
  }

  if (msg.includes('Invalid configuration')) {
    return {
      title: 'Configuration Error',
      message: 'Your braseh.ts file has schema errors.',
      hint: 'Run "braseh check" for detailed validation.',
    };
  }

  if (msg.includes('EACCES') || msg.includes('permission denied')) {
    return {
      title: 'Permission Denied',
      message: msg,
      hint: 'Check your file permissions or try adding "become: true" to the resource.',
    };
  }

  if (msg.includes('ENOENT')) {
    return {
      title: 'File Not Found',
      message: msg,
      hint: 'Ensure all paths in your configuration are correct.',
    };
  }

  return {
    title: 'Unexpected Error',
    message: msg,
    hint: 'If this persists, please report a bug.',
  };
}

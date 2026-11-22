import { describe, it, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { App, Stack } from '../core/app';
import { LineInFileResource } from './line-in-file';
import { FileSystem } from '../services/fs';

describe('LineInFileResource', () => {
  const MockFS = (files: Record<string, string> = {}) => Layer.succeed(FileSystem, FileSystem.of({
    exists: (path: string) => Effect.succeed(files[path] !== undefined),
    readFile: (path: string) => Effect.succeed(files[path] || ''),
    writeFile: (path: string, content: string) => Effect.sync(() => { files[path] = content; }),
    writeFileBytes: () => Effect.void,
  } as any));

  it('should append a line if it does not exist', async () => {
    const files = { '/tmp/test.txt': 'line1\nline2' };
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new LineInFileResource(stack, 'test-res', {
      path: '/tmp/test.txt',
      line: 'line3'
    });

    await Effect.runPromise(res.apply().pipe(Effect.provide(MockFS(files))));
    
    expect(files['/tmp/test.txt']).toBe('line1\nline2\nline3');
  });

  it('should replace a line matching a regexp', async () => {
    const files = { '/tmp/test.txt': 'export VAR=old\nother line' };
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new LineInFileResource(stack, 'test-res', {
      path: '/tmp/test.txt',
      line: 'export VAR=new',
      regexp: '^export VAR='
    });

    await Effect.runPromise(res.apply().pipe(Effect.provide(MockFS(files))));
    
    expect(files['/tmp/test.txt']).toBe('export VAR=new\nother line');
  });

  it('should remove a line when state is absent', async () => {
    const files = { '/tmp/test.txt': 'line1\nline2\nline3' };
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new LineInFileResource(stack, 'test-res', {
      path: '/tmp/test.txt',
      line: 'line2',
      state: 'absent'
    });

    await Effect.runPromise(res.apply().pipe(Effect.provide(MockFS(files))));
    
    expect(files['/tmp/test.txt']).toBe('line1\nline3');
  });

  it('should remove lines matching a regexp when state is absent', async () => {
    const files = { '/tmp/test.txt': 'line1\n# DELETE ME\nline2' };
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new LineInFileResource(stack, 'test-res', {
      path: '/tmp/test.txt',
      line: '',
      regexp: '^# DELETE ME',
      state: 'absent'
    });

    await Effect.runPromise(res.apply().pipe(Effect.provide(MockFS(files))));
    
    expect(files['/tmp/test.txt']).toBe('line1\nline2');
  });

  it('keeps the final newline when appending', async () => {
    const files: Record<string, string> = { '/tmp/rc': 'a\nb\n' };
    const stack = new Stack(new App(), 'test');
    await Effect.runPromise(new LineInFileResource(stack, 'l', { path: '/tmp/rc', line: 'new' }).apply().pipe(Effect.provide(MockFS(files))));
    expect(files['/tmp/rc']).toBe('a\nb\nnew\n');
  });

  it('writes a missing file as the line plus a newline', async () => {
    const files: Record<string, string> = {};
    const stack = new Stack(new App(), 'test');
    await Effect.runPromise(new LineInFileResource(stack, 'l', { path: '/tmp/new-rc', line: 'only' }).apply().pipe(Effect.provide(MockFS(files))));
    expect(files['/tmp/new-rc']).toBe('only\n');
  });
});

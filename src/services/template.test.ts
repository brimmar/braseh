import { describe, it, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { TemplateService, TemplateServiceLive } from './template';

describe('TemplateService', () => {
  it('should render a mustache template', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* TemplateService;
      return yield* svc.render('Hello {{name}}!', { name: 'World' });
    });

    const result = await Effect.runPromise(Effect.provide(program, TemplateServiceLive));
    expect(result).toBe('Hello World!');
  });

  it('does not HTML-escape values, since the output is a config file', async () => {
    const result = await Effect.runPromise(Effect.provide(
      Effect.flatMap(TemplateService, (svc) => svc.render('{{url}} {{q}}', { url: 'https://x.io/p?a=1&b=2', q: `"it's"` })),
      TemplateServiceLive,
    ));
    expect(result).toBe(`https://x.io/p?a=1&b=2 "it's"`);
  });
});

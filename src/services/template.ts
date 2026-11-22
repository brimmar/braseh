import { Context, Effect, Layer } from 'effect';
import Mustache from 'mustache';

export interface TemplateService {
  readonly render: (template: string, view: any) => Effect.Effect<string, Error>;
}

export const TemplateService = Context.GenericTag<TemplateService>('TemplateService');

export const TemplateServiceLive = Layer.succeed(
  TemplateService,
  TemplateService.of({
    render: (template, view) =>
      Effect.try({
        // No HTML escaping: these are config files, where {{url}} must stay https://x/y, not https:&#x2F;...
        try: () => Mustache.render(template, view, {}, { escape: (value) => String(value) }),
        catch: (error) => new Error(`Failed to render template: ${String(error)}`),
      }),
  })
);

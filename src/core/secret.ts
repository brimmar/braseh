export class SecretToken {
  constructor(public readonly name: string) {}

  toString() {
    return `Secret(${this.name})`;
  }
}

export const secret = (name: string) => new SecretToken(name);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Every SecretToken in a value, looking inside arrays and plain objects (not class instances like resources). */
export function secretTokens(value: unknown): SecretToken[] {
  if (value instanceof SecretToken) return [value];
  if (Array.isArray(value)) return value.flatMap(secretTokens);
  if (isPlainObject(value)) return Object.values(value).flatMap(secretTokens);
  return [];
}

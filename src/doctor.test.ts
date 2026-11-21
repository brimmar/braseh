import { describe, it, expect } from 'bun:test';
import { brasehDoctor } from './commands/doctor';

describe('braseh doctor', () => {
  it('should run without error', async () => {
    // This is an integration test that runs real system checks.
    // It might be flaky if environment is weird, but good for sanity check.
    await brasehDoctor();
  });

  it('supports json mode and returns DoctorResult', async () => {
    const result = await brasehDoctor({ json: true });
    expect(result).toBeDefined();
    expect(result.command).toBe('doctor');
    expect(typeof result.success).toBe('boolean');
    expect(result.os).toBeDefined();
    expect(typeof result.os.platform).toBe('string');
    expect(typeof result.tools).toBe('object');
    expect(typeof result.writeAccess).toBe('boolean');
  });
});

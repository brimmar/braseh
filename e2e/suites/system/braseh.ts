// E2E System Suite — user, group, aptRepository
import { user, group, aptRepository, pkg, script, onPlatform } from 'braseh';

export default () => {
  onPlatform('linux', () => {
    // ── group ──────────────────────────────────────────────────────────────────
    const devGroup = group('braseh-testgroup', { become: true });

    // ── user ───────────────────────────────────────────────────────────────────
    // Create a user with a specific shell and group membership
    user('braseh-testuser', {
      become: true,
      shell: '/bin/bash',
      createHome: true,
      groups: ['braseh-testgroup'],
      dependsOn: [devGroup],
    });

    // ── aptRepository ──────────────────────────────────────────────────────────
    // Add the git-core PPA (Ubuntu-maintained, stable, no external key needed).
    // This is a real apt sources.list entry — tests that braseh writes the file
    // and runs apt-get update correctly.
    //
    // We use the Ubuntu universe repo (always available on Ubuntu) as a safe test:
    // add it as a named custom source to test the full aptRepository flow.
    aptRepository('braseh-test-repo', {
      become: true,
      uri: 'http://archive.ubuntu.com/ubuntu',
      distribution: 'noble',
      components: ['universe'],
      // No GPG key needed for standard Ubuntu repos
    });

    // ── user: absent (removal) ─────────────────────────────────────────────────
    // Install then remove a separate user to test the absent state
    const tempUser = user('braseh-tempuser', { become: true, createHome: false });
    user('braseh-tempuser', {
      become: true,
      state: 'absent',
      dependsOn: [tempUser],
    });

    // ── group: absent ──────────────────────────────────────────────────────────
    const tempGroup = group('braseh-tempgroup', { become: true });
    group('braseh-tempgroup', {
      become: true,
      state: 'absent',
      dependsOn: [tempGroup],
    });
  });
};

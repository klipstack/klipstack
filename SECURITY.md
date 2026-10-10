# Security

Please report security problems privately, not in a public issue.

- Preferred: [report a vulnerability](https://github.com/klipstack/klipstack/security/advisories/new)
  through GitHub's private reporting.
- Or email hello@klipstack.com with "Security" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. We will
confirm we received it within a few days, keep you informed while we fix it, and credit you when
the fix is released, if you want.

The service at klipstack.com runs the latest commit on `main`; fixes reach it when they merge.
Self-hosted instances get them by upgrading to an image built after the fix. Please test only
against your own instance or account, and never access other people's data.

[docs/security.md](docs/security.md) describes the security boundaries the code is meant to keep.

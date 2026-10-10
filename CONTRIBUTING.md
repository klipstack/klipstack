# Contributing

Klipstack is open source, but it does not accept code contributions for now: pull requests are
open to the maintainer only. Reviewing outside changes takes longer than making them, so the
maintainer writes the code, and the most useful help is telling us what to fix or build.

## How to help

- **Report a bug** as an issue: what you did, what you expected, what happened, and the browser or
  device. Steps to reproduce help most.
- **Suggest a feature** as an issue: the problem it solves for you, more than the solution.
- **Report a security problem privately**, never in an issue: see [SECURITY.md](SECURITY.md).

## Run it yourself

You are welcome to fork Klipstack and change it under the [AGPL-3.0](LICENSE). The
[README](README.md#development) sets up a local copy (Node 22, pnpm 10 and Docker), and
[AGENTS.md](AGENTS.md) has the conventions: architecture, code style, tests and commands. To run
your own instance, see [docs/self-hosting](docs/self-hosting/README.md).

## License

Klipstack is licensed under the [GNU AGPL, version 3](LICENSE), except `packages/sdk` and
`packages/api-contract`, which are MIT. See [NOTICE](NOTICE).

# Fantasia

Multi-agent orchestration system built on the Claude Agent SDK. Five
Fantasia-themed agents (Mickey, Yen Sid, Chernabog, Broomstick, Imagineer)
collaborate to plan, review, and execute tasks.

## A note from humanity

This system is entirely vibe coded. It's an experiment to see if I can actually build software this way. I have looked at the code, but not all of it. Probably don't run this yourself unless either your ability to mitigate risk or your risk tolerance is pretty advanced. Also, nobody sue me. The AS IS disclaimer in the license is load bearing for this repo.

## Prerequisites

- [Bun](https://bun.sh/) (runtime for core + server)
- [Rust](https://rustup.rs/) (for the TUI client)
- Either `ANTHROPIC_API_KEY` set in your environment or an existing claude code cli auth (just run claude and authenticate before running the server)

## Install

```sh
bun install
```

## Run the server

```sh
cd server
bun run src/index.ts
# Listening on /tmp/fantasia.sock
```

Override the socket path with a CLI arg or `FANTASIA_SOCKET` env var:

```sh
bun run src/index.ts /tmp/my.sock
```

## Run the TUI client

In a second terminal:

```sh
cd client
cargo run
```

The client connects to `/tmp/fantasia.sock`, initializes the orchestrator if
needed, and opens a chat interface to Mickey.

## Run tests

```sh
cd core && bun test      # core unit tests
cd server && bun test    # server RPC tests
```

## Project layout

```
core/       @fantasia/core   — orchestrator, agents, task queue, memory, events
server/     @fantasia/server — Connect RPC server over Unix socket
client/     fantasia-client  — Rust ratatui TUI
API.md      Full API reference (proto services + core library)
```

## Further reading

See [API.md](API.md) for the complete API reference covering all RPC services,
proto types, core library classes, agent configurations, and the task pipeline.

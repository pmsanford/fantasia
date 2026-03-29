# Fantasia

Multi-agent orchestration system built on the Claude Agent SDK. Five
Fantasia-themed agents (Mickey, Yen Sid, Chernabog, Broomstick, Imagineer)
collaborate to plan, review, and execute tasks.

## Prerequisites

- [Bun](https://bun.sh/) (runtime for core + server)
- [Rust](https://rustup.rs/) (for the TUI client)
- `ANTHROPIC_API_KEY` set in your environment

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

# Fantasia

Multi-agent orchestration system built on the Claude Agent SDK. Six
Fantasia-themed agents (Mickey, Yen Sid, Chernabog, Jacchus, Broomstick, Imagineer)
collaborate to plan, review, research, and execute tasks.

## A note from humanity

This system is entirely vibe coded. It's an experiment to see if I can actually build software this way. I have looked at the code, but not all of it. Probably don't run this yourself unless either your ability to mitigate risk or your risk tolerance is pretty advanced. Also, nobody sue me. The AS IS disclaimer in the license is load bearing for this repo.

## How it works

You chat with Mickey, who acts as your interface. Describe a task and the system plans, reviews, researches, and executes it — with parallel workers coordinating via milestones. You watch it happen in the TUI.

### Agents

- **Mickey** — Your conversational entry point. Triages requests: answers trivial questions directly, routes single-step tasks to a worker, and sends complex tasks through the full planning pipeline. Reports results back when done.
- **Yen Sid** — The planner. Reads the codebase, designs a plan, and organizes work into named workstreams. Defines milestone dependencies between workstreams so that one can wait on another's output before proceeding.
- **Chernabog** — The adversarial critic. Reviews Yen Sid's plan before any work starts, challenging assumptions, looking for edge cases and failure modes, and blocking execution if the plan has fundamental flaws.
- **Jacchus** — The reconnaissance scout. Runs in parallel with Chernabog's review. Explores the codebase to find relevant files, patterns, and gotchas for each workstream. His findings are injected into each Broomstick's context so they don't waste time on redundant exploration.
- **Broomstick** — Worker agents. One spawns per workstream and runs in parallel. Each gets its own focused prompt, the shared plan context, and Jacchus's recon findings. Workers emit milestones when they complete a dependency and wait on upstream milestones before starting dependent work.
- **Imagineer** — The monitor and repair agent. Periodically checks the health of all running agents, detects stuck or erroring agents, and recommends interventions (restart, abort, retry).

### Example flow

1. You type: *"Refactor the auth module to use JWT, update all callers, and write tests"*
2. Mickey routes it to Yen Sid
3. Yen Sid reads the codebase and produces a plan: three workstreams — `jwt-core`, `callers-update` (waits on milestone `jwt-types-defined`), and `test-suite`
4. Chernabog reviews the plan and approves it; simultaneously Jacchus scouts relevant files and patterns
5. Three Broomstick agents spin up with Jacchus's recon pre-loaded; `callers-update` waits until `jwt-core` emits its milestone
6. Mickey reports completion to you when all workstreams finish
7. Throughout, the **Plan** tab shows live workstream status and the dependency graph; pressing Enter on any workstream opens the agent's detail view

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

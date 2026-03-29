use crate::proto::fantasia_event;

use super::{
    state::{MessageRole, PartialMessage},
    AppEvent, AppState,
};

pub fn update(state: &mut AppState, event: AppEvent) {
    state.last_server_update = Some(std::time::Instant::now());
    match event {
        AppEvent::Initialized => {
            state.push_message(MessageRole::System, "Orchestrator initialized.".into());
        }

        AppEvent::SubmitDone => {
            state.submitting = false;
        }

        AppEvent::StatusResponse(resp) => {
            state.orchestrator_running = resp.running;
            state.agents = resp.agents;
            if let Some(counts) = resp.task_counts {
                state.task_counts = counts;
            }
        }

        AppEvent::CostResponse(resp) => {
            if let Some(cost) = resp.cost {
                state.total_cost_usd = cost.total_cost_usd;
            }
        }

        AppEvent::NetworkError(msg) => {
            state.submitting = false;
            state.set_status(format!("Error: {}", msg));
        }

        AppEvent::FantasiaEvent(ev) => match ev.payload {
            Some(fantasia_event::Payload::AgentMessage(msg)) => {
                let agent_name = state.agent_name(&msg.agent_id);

                if msg.is_partial {
                    match &mut state.partial_message {
                        Some(partial) if partial.agent_id == msg.agent_id => {
                            partial.content.push_str(&msg.content);
                        }
                        _ => {
                            // New partial stream (or different agent) — finalize any existing one
                            finalize_partial(state);
                            state.partial_message = Some(PartialMessage {
                                agent_id: msg.agent_id,
                                agent_name,
                                content: msg.content,
                            });
                        }
                    }
                } else {
                    // Finalize: combine any accumulated partial content
                    let content = if let Some(partial) = state.partial_message.take() {
                        if partial.agent_id == msg.agent_id {
                            let mut s = partial.content;
                            s.push_str(&msg.content);
                            s
                        } else {
                            // Different agent finished — push partial as its own message first
                            if !partial.content.is_empty() {
                                state.push_message(
                                    MessageRole::Agent(partial.agent_name),
                                    partial.content,
                                );
                            }
                            msg.content
                        }
                    } else {
                        msg.content
                    };
                    if !content.is_empty() {
                        state.submitting = false;
                        state.push_message(MessageRole::Agent(agent_name), content);
                    }
                }
                state.scroll_offset = 0;
            }

            Some(fantasia_event::Payload::AgentStatusChanged(ev)) => {
                let new_status = ev.new_status;
                for agent in &mut state.agents {
                    if agent.id == ev.agent_id {
                        agent.status = new_status;
                    }
                }
            }

            Some(fantasia_event::Payload::AgentSpawned(ev)) => {
                if let Some(agent) = ev.agent {
                    if let Some(existing) = state.agents.iter_mut().find(|a| a.id == agent.id) {
                        *existing = agent;
                    } else {
                        state.agents.push(agent);
                    }
                }
            }

            Some(fantasia_event::Payload::AgentTerminated(ev)) => {
                state.agents.retain(|a| a.id != ev.agent_id);
            }

            Some(fantasia_event::Payload::TaskCreated(ev)) => {
                if let Some(task) = ev.task {
                    let desc = task.description.clone();
                    state.push_message(
                        MessageRole::System,
                        format!("Task created: {}", truncate(&desc, 60)),
                    );
                    state.task_counts.total += 1;
                    state.task_counts.pending += 1;
                }
            }

            Some(fantasia_event::Payload::TaskCompleted(ev)) => {
                state.push_message(
                    MessageRole::System,
                    format!("Task {} completed.", short_id(&ev.task_id)),
                );
                state.task_counts.completed += 1;
                state.task_counts.active = state.task_counts.active.saturating_sub(1);
            }

            Some(fantasia_event::Payload::TaskFailed(ev)) => {
                state.push_message(
                    MessageRole::System,
                    format!(
                        "Task {} failed: {}",
                        short_id(&ev.task_id),
                        truncate(&ev.error, 60)
                    ),
                );
                state.task_counts.failed += 1;
                state.task_counts.active = state.task_counts.active.saturating_sub(1);
            }

            Some(fantasia_event::Payload::TaskStatusChanged(ev)) => {
                use crate::proto::TaskStatus as TS;
                let new = TS::try_from(ev.new_status).unwrap_or(TS::Unspecified);
                let old = TS::try_from(ev.old_status).unwrap_or(TS::Unspecified);
                let was_active = matches!(old, TS::Planning | TS::Reviewing | TS::InProgress);
                let is_active = matches!(new, TS::Planning | TS::Reviewing | TS::InProgress);
                match (was_active, is_active) {
                    (false, true) => state.task_counts.active += 1,
                    (true, false) => {
                        state.task_counts.active = state.task_counts.active.saturating_sub(1)
                    }
                    _ => {}
                }
                if matches!(old, TS::Pending) {
                    state.task_counts.pending = state.task_counts.pending.saturating_sub(1);
                }
            }

            Some(fantasia_event::Payload::CostUpdate(ev)) => {
                state.total_cost_usd = ev.total_cost_usd;
            }

            Some(fantasia_event::Payload::OrchestratorReady(_)) => {
                state.orchestrator_running = true;
                state.push_message(MessageRole::System, "Orchestrator ready.".into());
            }

            Some(fantasia_event::Payload::OrchestratorError(ev)) => {
                state.orchestrator_running = false;
                state.set_status(format!("Orchestrator error: {}", ev.error_message));
                state.push_message(
                    MessageRole::System,
                    format!("Orchestrator error: {}", ev.error_message),
                );
            }

            Some(fantasia_event::Payload::OrchestratorStopped(_)) => {
                state.orchestrator_running = false;
                state.push_message(MessageRole::System, "Orchestrator stopped.".into());
            }

            Some(fantasia_event::Payload::UserInputNeeded(ev)) => {
                state.push_message(
                    MessageRole::System,
                    format!("Waiting for input: {}", ev.prompt),
                );
            }

            None => {}
        },
    }
}

/// Push any in-progress partial message as a committed message.
fn finalize_partial(state: &mut AppState) {
    if let Some(partial) = state.partial_message.take() {
        if !partial.content.is_empty() {
            state.push_message(MessageRole::Agent(partial.agent_name), partial.content);
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max.min(s.len())])
    }
}

fn short_id(id: &str) -> &str {
    &id[..id.len().min(8)]
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function textOfContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof part === 'string' ? part : part?.text ?? part?.input_text ?? part?.output_text ?? ''))
    .filter(Boolean)
    .join('\n');
}

function exitOk(output) {
  if (typeof output !== 'string') return true;
  const match = output.match(/Process exited with code\s+(-?\d+)/i);
  if (match) return Number(match[1]) === 0;
  if (/exit code\s+[1-9]\d*/i.test(output)) return false;
  return true;
}

/**
 * Maps one Codex rollout record to zero or more normalized pet events.
 * This function is deliberately pure so it can be tested without a live Codex.
 */
export function mapCodexRecord(record) {
  if (!record || typeof record !== 'object') return [];
  const payload = record.payload ?? {};

  if (record.type === 'session_meta') {
    return [{
      type: 'session.attached',
      session: payload.id ?? payload.session_id ?? null,
      model: payload.model_provider ?? null,
      cwd: payload.cwd ?? null,
    }];
  }

  if (record.type === 'turn_context') {
    return [{
      type: 'session.context',
      session: payload.turn_id ?? payload.root_turn_id ?? null,
      model: payload.model ?? null,
    }];
  }

  if (record.type === 'turn_usage' || record.type === 'token_usage_record') {
    const usage = payload.usage ?? payload;
    return [{
      type: 'usage.updated',
      usage: {
        input: usage.input_tokens ?? usage.input ?? null,
        output: usage.output_tokens ?? usage.output ?? null,
        total: usage.total_tokens ?? usage.total ?? null,
        cached: usage.cached_input_tokens ?? usage.cached ?? null,
      },
    }];
  }

  if (record.type === 'response_item') {
    const type = payload.type;
    if (type === 'function_call') {
      const name = payload.name ?? 'unknown';
      return [{
        type: 'tool.started',
        id: payload.call_id ?? payload.id ?? name,
        name,
        args: parseArgs(payload.arguments),
      }];
    }
    if (type === 'function_call_output') {
      return [{
        type: 'tool.finished',
        id: payload.call_id ?? payload.id ?? 'unknown',
        ok: exitOk(payload.output),
        message: exitOk(payload.output) ? null : '工具执行失败',
      }];
    }
    if (type === 'reasoning') {
      return [{ type: 'agent.reasoning' }];
    }
    return [];
  }

  if (record.type !== 'event_msg') return [];

  switch (payload.type) {
    case 'task_started':
      return [{ type: 'turn.started', session: payload.turn_id ?? null }];

    case 'task_complete':
      return [{
        type: 'turn.completed',
        summary: typeof payload.last_agent_message === 'string' ? payload.last_agent_message : null,
        durationMs: payload.duration_ms ?? null,
      }];

    case 'turn_aborted':
    case 'error':
    case 'stream_error':
      return [{
        type: 'turn.failed',
        message: payload.message ?? payload.error ?? '这一轮没有完成',
      }];

    case 'item_completed': {
      const item = payload.item ?? {};
      if (item.type === 'UserMessage') {
        return [{ type: 'user.message', text: textOfContent(item.content) }];
      }
      if (item.type === 'AgentMessage') {
        return [{ type: 'agent.message', text: textOfContent(item.content) }];
      }
      if (item.type === 'Reasoning') {
        return [{ type: 'agent.reasoning' }];
      }
      if (item.type === 'CommandExecution') {
        const ok = item.exit_code == null || Number(item.exit_code) === 0;
        return [{
          type: 'tool.result',
          ok,
          message: ok ? null : `命令退出码 ${item.exit_code}`,
          command: item.command ?? null,
        }];
      }
      return [];
    }

    default:
      return [];
  }
}


function clippedText(value, limit = 16_000) {
  if (typeof value !== "string") return null;
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function sanitizeProjectedEvent(event) {
  if (!event || typeof event !== "object" || typeof event.type !== "string") return null;
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  if (event.type === "text_delta") {
    return { type: "text_delta", payload: { delta: clippedText(payload.delta) ?? "" } };
  }
  if (["thinking_start", "thinking_end"].includes(event.type)) {
    return { type: event.type, payload: {} };
  }
  if (event.type === "tool_call") {
    return {
      type: "tool_call",
      payload: { toolCallId: payload.toolCallId ?? null, toolName: payload.toolName ?? null },
    };
  }
  if (["tool_start", "tool_end"].includes(event.type)) {
    return {
      type: event.type,
      payload: {
        toolCallId: payload.toolCallId ?? null,
        toolName: payload.toolName ?? null,
        ...(event.type === "tool_end" ? { isError: Boolean(payload.isError) } : {}),
      },
    };
  }
  if (event.type === "compaction_start") {
    return { type: "compaction_start", payload: { reason: payload.reason ?? null } };
  }
  if (event.type === "compaction_end") {
    return {
      type: "compaction_end",
      payload: {
        reason: payload.reason ?? null,
        aborted: Boolean(payload.aborted),
        willRetry: Boolean(payload.willRetry),
        tokensBefore: payload.tokensBefore ?? null,
        estimatedTokensAfter: payload.estimatedTokensAfter ?? null,
      },
    };
  }
  if (event.type === "auto_retry_start" || event.type === "auto_retry_end") {
    return {
      type: event.type,
      payload: {
        attempt: payload.attempt ?? null,
        maxAttempts: payload.maxAttempts ?? null,
        success: payload.success ?? null,
      },
    };
  }
  if (["agent_start", "agent_end", "agent_settled", "turn_start", "turn_end"].includes(event.type)) {
    return { type: event.type, payload: {} };
  }
  if (event.type === "extension_error") {
    return {
      type: "extension_error",
      payload: { event: payload.event ?? null, error: clippedText(payload.error, 2_000) },
    };
  }
  return null;
}

export function projectPiConversationEvent(event) {
  if (!event || typeof event !== "object" || typeof event.type !== "string") return null;
  if (
    Object.hasOwn(event, "payload")
    || ["text_delta", "tool_call", "tool_start", "tool_end"].includes(event.type)
  ) {
    const projected = sanitizeProjectedEvent(event);
    if (projected) return projected;
  }
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update?.type === "text_delta") {
      return { type: "text_delta", payload: { delta: clippedText(update.delta) ?? "" } };
    }
    if (update?.type === "thinking_start" || update?.type === "thinking_end") {
      return { type: update.type, payload: {} };
    }
    if (update?.type === "toolcall_end") {
      return {
        type: "tool_call",
        payload: {
          toolCallId: update.toolCall?.id ?? null,
          toolName: update.toolCall?.name ?? null,
        },
      };
    }
    return null;
  }
  if (event.type === "tool_execution_start") {
    return {
      type: "tool_start",
      payload: { toolCallId: event.toolCallId ?? null, toolName: event.toolName ?? null },
    };
  }
  if (event.type === "tool_execution_end") {
    return {
      type: "tool_end",
      payload: {
        toolCallId: event.toolCallId ?? null,
        toolName: event.toolName ?? null,
        isError: Boolean(event.isError),
      },
    };
  }
  if (event.type === "compaction_start") {
    return { type: "compaction_start", payload: { reason: event.reason ?? null } };
  }
  if (event.type === "compaction_end") {
    return {
      type: "compaction_end",
      payload: {
        reason: event.reason ?? null,
        aborted: Boolean(event.aborted),
        willRetry: Boolean(event.willRetry),
        tokensBefore: event.result?.tokensBefore ?? null,
        estimatedTokensAfter: event.result?.estimatedTokensAfter ?? null,
      },
    };
  }
  if (event.type === "auto_retry_start" || event.type === "auto_retry_end") {
    return {
      type: event.type,
      payload: {
        attempt: event.attempt ?? null,
        maxAttempts: event.maxAttempts ?? null,
        success: event.success ?? null,
      },
    };
  }
  if (["agent_start", "agent_end", "agent_settled", "turn_start", "turn_end"].includes(event.type)) {
    return { type: event.type, payload: {} };
  }
  if (event.type === "extension_error") {
    return {
      type: "extension_error",
      payload: { event: event.event ?? null, error: clippedText(event.error, 2_000) },
    };
  }
  return null;
}

export { clippedText };

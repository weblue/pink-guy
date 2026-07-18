const ACTIVE_STATUS = "active";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function row(title, detail, className = "") {
  return `<div class="row${className ? ` ${className}` : ""}"><strong>${escapeHtml(title)}</strong>`
    + `<div class="muted">${escapeHtml(detail)}</div></div>`;
}

function isActiveLease(item) {
  // Presentation-only rule: the live lease is the durable record whose status is exactly `active`.
  return item?.status === ACTIVE_STATUS;
}

export function splitOrchestratorLeaseRecords({ projectOrchestrators = [], conversationLeases = [] } = {}) {
  const activeProjectOrchestrators = [];
  const inactiveProjectOrchestrators = [];
  for (const item of projectOrchestrators) {
    (isActiveLease(item) ? activeProjectOrchestrators : inactiveProjectOrchestrators).push(item);
  }

  const activeConversationLeases = [];
  const inactiveConversationLeases = [];
  for (const item of conversationLeases) {
    (isActiveLease(item) ? activeConversationLeases : inactiveConversationLeases).push(item);
  }

  return {
    activeProjectOrchestrators,
    inactiveProjectOrchestrators,
    activeConversationLeases,
    inactiveConversationLeases,
    inactiveCount: inactiveProjectOrchestrators.length + inactiveConversationLeases.length,
  };
}

export function renderOrchestratorLeasesPanel({ projectOrchestrators = [], conversationLeases = [] } = {}) {
  const split = splitOrchestratorLeaseRecords({ projectOrchestrators, conversationLeases });
  const activeProjectMarkup = split.activeProjectOrchestrators.length
    ? split.activeProjectOrchestrators.map((item) => row(
      item.project_name,
      `${item.transport} · ${item.status} · task commands`,
    )).join("")
    : `<p class="muted">No active project orchestrator leases.</p>`;
  const activeConversationMarkup = split.activeConversationLeases.length
    ? split.activeConversationLeases.map((item) => row(
      `${item.scope_type}:${item.scope_id}`,
      `${item.transport} · ${item.status} · ${item.endpoint} · conversations`,
    )).join("")
    : `<p class="muted">No active conversation leases.</p>`;
  const historyItems = [
    ...split.inactiveProjectOrchestrators.map((item) => ({
      title: item.project_name,
      detail: `${item.transport} · ${item.status} · task commands`,
    })),
    ...split.inactiveConversationLeases.map((item) => ({
      title: `${item.scope_type}:${item.scope_id}`,
      detail: `${item.transport} · ${item.status} · ${item.endpoint} · conversations`,
    })),
  ];

  return [
    `<div class="muted">Active leases stay in the primary view; historical leases collapse below.</div>`,
    `<h3>Active project orchestrators</h3>${activeProjectMarkup}`,
    `<h3>Active conversation leases</h3>${activeConversationMarkup}`,
    split.inactiveCount
      ? `<details class="row lease-history"><summary><strong>Lease history</strong> · ${split.inactiveCount} inactive</summary>`
        + historyItems.map((item) => row(item.title, item.detail, "history")).join("")
        + `</details>`
      : `<p class="muted">No inactive lease history.</p>`,
  ].join("");
}

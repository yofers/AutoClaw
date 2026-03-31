export async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("请先登录。");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

export function loadStatus() {
  return fetchJson("/api/status");
}

export function loadConfig() {
  return fetchJson("/api/config");
}

export function loadSkills() {
  return fetchJson("/api/skills");
}

export function loadSkillsPage(cursor) {
  return fetchJson("/api/skills/page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cursor }),
  });
}

export function installSkill(payload) {
  return fetchJson("/api/skills/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function loadOnboardDefaults() {
  return fetchJson("/api/onboard");
}

export function createAction(action) {
  return fetchJson("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export function loadActionJob(jobId) {
  return fetchJson(`/api/action/${jobId}`);
}

export function runOnboard(payload) {
  return fetchJson("/api/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function saveConfig(raw) {
  return fetchJson("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
}

export function logout() {
  return fetchJson("/api/logout", {
    method: "POST",
  });
}

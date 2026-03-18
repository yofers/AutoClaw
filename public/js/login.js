const loginForm = document.querySelector("#login-form");
const usernameInput = document.querySelector("#login-username");
const passwordInput = document.querySelector("#login-password");
const submitButton = document.querySelector("#login-submit");
const feedback = document.querySelector("#login-feedback");
const loginAppTitle = document.querySelector("#login-app-title");
const loginAppSubtitle = document.querySelector("#login-app-subtitle");

function nextPath() {
  const value = new URLSearchParams(window.location.search).get("next") || "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function setFeedback(message) {
  if (!message) {
    feedback.hidden = true;
    feedback.textContent = "";
    return;
  }

  feedback.hidden = false;
  feedback.textContent = message;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return body;
}

async function loadSessionState() {
  const session = await fetchJson("/api/session");
  document.title = `${session.appTitle} 登录`;
  loginAppTitle.textContent = session.appTitle;
  loginAppSubtitle.textContent = session.appSubtitle;

  if (!session.authEnabled || session.authenticated) {
    window.location.replace("/");
    return;
  }

  usernameInput.focus();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFeedback("");
  submitButton.disabled = true;

  try {
    await fetchJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      }),
    });
    window.location.replace(nextPath());
  } catch (error) {
    passwordInput.value = "";
    setFeedback(error.message);
    passwordInput.focus();
  } finally {
    submitButton.disabled = false;
  }
});

loadSessionState().catch((error) => {
  setFeedback(error.message);
});

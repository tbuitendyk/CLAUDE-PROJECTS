/* Spanish Video Dubber control panel.
 *
 * Talks to the youtube-spanish-dubber HTTP API through nginx's
 * `/dubber/api/` reverse-proxy location, which is protected with HTTP Basic
 * Auth (see ../../nginx/www.buitendyk.ca.conf). The browser's native auth
 * prompt -- triggered the first time a request gets a 401 -- is the "sign
 * in"; once credentials are cached for this origin, every request below
 * (including the actual job submission) carries them automatically. Until
 * that happens, the submit button stays visibly present but "ghosted"
 * (disabled + dimmed) so visitors can see what the tool does without being
 * able to trigger a real upload.
 */
(function () {
  "use strict";

  const API_BASE = "/dubber/api";
  const POLL_INTERVAL_MS = 4000;

  const authDot = document.getElementById("auth-dot");
  const authText = document.getElementById("auth-text");
  const signinBtn = document.getElementById("signin-btn");
  const submitBtn = document.getElementById("submit-btn");
  const form = document.getElementById("dub-form");
  const formMessage = document.getElementById("form-message");
  const jobList = document.getElementById("job-list");

  let authenticated = false;
  const pollTimers = new Map(); // job id -> setInterval handle

  function setAuthState(state, text) {
    authDot.className = "dot " + state;
    authText.textContent = text;
    authenticated = state === "unlocked";
    submitBtn.disabled = !authenticated;
    submitBtn.classList.toggle("ghosted", !authenticated);
    signinBtn.style.display = authenticated ? "none" : "";
  }

  async function checkAuth() {
    try {
      const res = await fetch(`${API_BASE}/healthz`, { credentials: "same-origin" });
      if (res.ok) {
        setAuthState("unlocked", "Signed in — dubbing is enabled.");
      } else if (res.status === 401 || res.status === 403) {
        setAuthState("locked", "Sign in to enable dubbing.");
      } else {
        setAuthState("error", `Dubber service returned an unexpected status (HTTP ${res.status}).`);
      }
    } catch (err) {
      setAuthState("error", "Couldn't reach the dubber service — is it running?");
    }
  }

  signinBtn.addEventListener("click", () => {
    setAuthState("locked", "Checking access…");
    checkAuth();
  });

  function renderJob(job) {
    let card = document.getElementById(`job-${job.id}`);
    if (!card) {
      card = document.createElement("div");
      card.className = "job-card";
      card.id = `job-${job.id}`;
      jobList.prepend(card);
    }
    card.textContent = "";

    const headline = document.createElement("div");
    const idLabel = document.createElement("span");
    idLabel.className = "job-id";
    idLabel.textContent = `Job ${job.id} — `;
    const stage = document.createElement("span");
    stage.className = "job-stage";
    stage.textContent = job.stage || job.status;
    headline.appendChild(idLabel);
    headline.appendChild(stage);
    card.appendChild(headline);

    if (job.progress) {
      const progress = document.createElement("div");
      progress.className = "hint";
      progress.textContent = job.progress;
      card.appendChild(progress);
    }

    if (job.status === "done" && job.youtube_video_url) {
      const wrap = document.createElement("div");
      wrap.style.marginTop = "0.5rem";
      const link = document.createElement("a");
      link.className = "job-link";
      link.href = job.youtube_video_url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `Published → ${job.youtube_video_url}`;
      wrap.appendChild(link);
      card.appendChild(wrap);
    }

    if (job.status === "failed" && job.error) {
      const err = document.createElement("div");
      err.className = "job-error";
      err.textContent = job.error.split("\n")[0];
      card.appendChild(err);
    }

    return card;
  }

  function pollJob(jobId) {
    if (pollTimers.has(jobId)) return;

    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/jobs/${jobId}`, { credentials: "same-origin" });
        if (!res.ok) return;
        const job = await res.json();
        renderJob(job);
        if (job.status === "done" || job.status === "failed") {
          clearInterval(pollTimers.get(jobId));
          pollTimers.delete(jobId);
        }
      } catch (err) {
        /* transient network hiccup — keep polling */
      }
    };

    pollTimers.set(jobId, setInterval(tick, POLL_INTERVAL_MS));
    tick();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!authenticated) return;

    const url = document.getElementById("video-url").value.trim();
    const targetLanguage = document.getElementById("target-lang").value;

    formMessage.textContent = "Submitting…";
    submitBtn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url, target_language: targetLanguage }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const detail = data && (data.detail || data.message);
        const message = typeof detail === "string" ? detail : JSON.stringify(detail || `HTTP ${res.status}`);
        formMessage.textContent = `Couldn't submit the job: ${message}`;
        return;
      }

      formMessage.textContent = `Queued as job ${data.id}. Tracking progress below.`;
      form.reset();
      renderJob(data);
      pollJob(data.id);
    } catch (err) {
      formMessage.textContent = "Couldn't reach the dubber service.";
    } finally {
      submitBtn.disabled = !authenticated;
    }
  });

  checkAuth();
})();

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
  const previewBtn = document.getElementById("preview-btn");
  const form = document.getElementById("dub-form");
  const formMessage = document.getElementById("form-message");
  const jobList = document.getElementById("job-list");

  let authenticated = false;
  const pollTimers = new Map(); // job id -> setInterval handle

  // The most recently rendered transcript preview, plus whatever edits the
  // visitor has saved against it: { url, targetLanguage, lines: [{start, end, text}] }.
  // When "Start dubbing" is submitted for the same video and language, these
  // lines are sent along as `transcript_overrides` so the dub speaks exactly
  // what was reviewed (and possibly hand-corrected) rather than a freshly
  // re-acquired and re-translated transcript that might differ.
  let previewState = null;

  function setAuthState(state, text) {
    authDot.className = "dot " + state;
    authText.textContent = text;
    authenticated = state === "unlocked";
    submitBtn.disabled = !authenticated;
    submitBtn.classList.toggle("ghosted", !authenticated);
    previewBtn.disabled = !authenticated;
    previewBtn.classList.toggle("ghosted", !authenticated);
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

  function formatTimestamp(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function renderTranscriptPreview(result, sourceUrl, targetLanguage) {
    const wrap = document.createElement("div");
    wrap.className = "transcript-preview";

    const summary = document.createElement("div");
    summary.className = "hint";
    summary.textContent = `Source: ${result.transcript_source}` +
      (result.original_language ? ` · original language: ${result.original_language}` : "");
    wrap.appendChild(summary);

    const rows = result.rows || [];
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No transcript lines were produced.";
      wrap.appendChild(empty);
      return wrap;
    }

    const hasOriginal = rows.some((row) => row.original_text != null);

    // This becomes the saved/editable record for this preview -- see
    // `previewState` above for how "Start dubbing" picks it back up.
    const state = {
      url: sourceUrl,
      targetLanguage: targetLanguage,
      lines: rows.map((row) => ({ start: row.start, end: row.end, text: row.translated_text || "" })),
    };
    previewState = state;

    const table = document.createElement("table");
    table.className = "transcript-table";
    table.classList.toggle("has-original", hasOriginal);

    // Fixed layout + <col> widths: a narrow time column, then Original and
    // Spanish sharing the rest with Spanish ~20% wider (its text tends to run
    // longer, and the extra room cuts down on textarea scrollbars). A
    // ResizeObserver below keeps each textarea's height matched to its
    // Original cell's rendered height.
    const colgroup = document.createElement("colgroup");
    const timeCol = document.createElement("col");
    timeCol.className = "col-time";
    colgroup.appendChild(timeCol);
    if (hasOriginal) {
      const originalCol = document.createElement("col");
      originalCol.className = "col-original";
      colgroup.appendChild(originalCol);
    }
    const translatedCol = document.createElement("col");
    translatedCol.className = "col-translated";
    colgroup.appendChild(translatedCol);
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const headings = ["Time"];
    if (hasOriginal) headings.push("Original");
    headings.push("Spanish (editable)");
    headings.forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    // Keeps each Spanish textarea's height matched to its Original cell's
    // rendered height -- so the edit box "goes down as far as" the English
    // text beside it, including as the page resizes and text rewraps.
    const heightSyncMap = hasOriginal && typeof ResizeObserver !== "undefined" ? new Map() : null;
    const heightObserver = heightSyncMap
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const textarea = heightSyncMap.get(entry.target);
            if (textarea) textarea.style.height = `${Math.ceil(entry.target.getBoundingClientRect().height)}px`;
          }
        })
      : null;

    const tbody = document.createElement("tbody");
    rows.forEach((row, index) => {
      const tr = document.createElement("tr");

      const timeCell = document.createElement("td");
      timeCell.className = "transcript-time";
      timeCell.textContent = formatTimestamp(row.start);
      tr.appendChild(timeCell);

      let origCell = null;
      if (hasOriginal) {
        origCell = document.createElement("td");
        origCell.className = "transcript-original";
        origCell.textContent = row.original_text || "";
        tr.appendChild(origCell);
      }

      const esCell = document.createElement("td");
      esCell.className = "transcript-translated";

      const editRow = document.createElement("div");
      editRow.className = "transcript-edit";

      const textarea = document.createElement("textarea");
      textarea.value = row.translated_text || "";
      textarea.setAttribute("aria-label", `Edit the Spanish line at ${formatTimestamp(row.start)}`);

      if (origCell && heightObserver) {
        heightSyncMap.set(origCell, textarea);
        heightObserver.observe(origCell);
      }

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn secondary transcript-save";
      saveBtn.textContent = "Save";

      const resetSaveLabel = () => {
        window.clearTimeout(saveBtn._resetTimer);
        saveBtn.textContent = "Save";
        esCell.classList.remove("saved");
      };

      textarea.addEventListener("input", resetSaveLabel);
      saveBtn.addEventListener("click", () => {
        state.lines[index].text = textarea.value;
        esCell.classList.add("saved");
        saveBtn.textContent = "Saved ✓";
        window.clearTimeout(saveBtn._resetTimer);
        saveBtn._resetTimer = window.setTimeout(() => { saveBtn.textContent = "Save"; }, 1500);
      });

      editRow.appendChild(textarea);
      editRow.appendChild(saveBtn);
      esCell.appendChild(editRow);
      tr.appendChild(esCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);

    const editHint = document.createElement("p");
    editHint.className = "hint";
    editHint.textContent = "Tweak any Spanish line above and click its Save button. Saved " +
      "lines for this same video and language are used automatically -- in place of a fresh " +
      "translation -- the next time you click “Start dubbing”.";
    wrap.appendChild(editHint);

    return wrap;
  }

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
    const stagePrefix = job.mode === "preview" ? "[preview] " : "";
    stage.textContent = stagePrefix + (job.stage || job.status);
    headline.appendChild(idLabel);
    headline.appendChild(stage);
    card.appendChild(headline);

    if (job.progress) {
      const progress = document.createElement("div");
      progress.className = "hint";
      progress.textContent = job.progress;
      card.appendChild(progress);
    }

    if (job.mode === "preview") {
      if (job.status === "done" && job.result) {
        card.appendChild(renderTranscriptPreview(job.result, job.source_url, job.target_language));
      }
    } else if (job.status === "done" && job.youtube_video_url) {
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

  async function submitJob(mode) {
    if (!authenticated) return;

    const url = document.getElementById("video-url").value.trim();
    if (!url) {
      formMessage.textContent = "Enter a video URL first.";
      return;
    }
    const targetLanguage = document.getElementById("target-lang").value;

    const payload = { url: url, target_language: targetLanguage, mode: mode };
    let usingSavedEdits = false;
    if (mode === "dub" && previewState && previewState.url === url && previewState.targetLanguage === targetLanguage) {
      payload.transcript_overrides = previewState.lines;
      usingSavedEdits = true;
    }

    formMessage.textContent = mode === "preview"
      ? "Submitting transcript preview…"
      : (usingSavedEdits ? "Submitting — using your saved transcript edits for this video…" : "Submitting…");
    submitBtn.disabled = true;
    previewBtn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const detail = data && (data.detail || data.message);
        const message = typeof detail === "string" ? detail : JSON.stringify(detail || `HTTP ${res.status}`);
        formMessage.textContent = `Couldn't submit the job: ${message}`;
        return;
      }

      formMessage.textContent = mode === "preview"
        ? `Queued transcript preview as job ${data.id}. Tracking progress below.`
        : (usingSavedEdits
            ? `Queued as job ${data.id} — it will use your saved transcript edits. Tracking progress below.`
            : `Queued as job ${data.id}. Tracking progress below.`);
      if (mode !== "preview") form.reset();
      renderJob(data);
      pollJob(data.id);
    } catch (err) {
      formMessage.textContent = "Couldn't reach the dubber service.";
    } finally {
      submitBtn.disabled = !authenticated;
      previewBtn.disabled = !authenticated;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitJob("dub");
  });

  previewBtn.addEventListener("click", () => {
    submitJob("preview");
  });

  checkAuth();
})();

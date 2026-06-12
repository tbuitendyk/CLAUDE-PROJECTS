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
  const serviceControls = document.getElementById("service-controls");
  const restartBtn = document.getElementById("restart-btn");
  const restartMessage = document.getElementById("restart-message");
  const thumbnailBtn = document.getElementById("thumbnail-btn");
  const thumbnailPanel = document.getElementById("thumbnail-panel");
  const rethumbBtn = document.getElementById("rethumb-btn");
  const rethumbPreview = document.getElementById("rethumb-preview");
  const rethumbMessage = document.getElementById("rethumb-message");

  let authenticated = false;
  const pollTimers = new Map(); // job id -> setInterval handle

  // The most recently rendered transcript preview, plus whatever edits the
  // visitor has saved against it: { url, targetLanguage, lines: [{start, end, text}] }.
  // When "Start dubbing" is submitted for the same video and language, these
  // lines are sent along as `transcript_overrides` so the dub speaks exactly
  // what was reviewed (and possibly hand-corrected) rather than a freshly
  // re-acquired and re-translated transcript that might differ.
  let previewState = null;

  // The thumbnail preview state now lives inside each makeThumbnailEditor
  // instance (the dub-flow and re-thumbnail editors defined near the bottom):
  //   { url, targetLanguage, original, generated, regions, bannerText, approved }
  // For the dub flow, an approved `generated` image is read back by submitJob
  // (via dubThumbEditor.getState) and sent as `thumbnail_override`.

  function setAuthState(state, text) {
    authDot.className = "dot " + state;
    authText.textContent = text;
    authenticated = state === "unlocked";
    submitBtn.disabled = !authenticated;
    submitBtn.classList.toggle("ghosted", !authenticated);
    previewBtn.disabled = !authenticated;
    previewBtn.classList.toggle("ghosted", !authenticated);
    thumbnailBtn.disabled = !authenticated;
    thumbnailBtn.classList.toggle("ghosted", !authenticated);
    if (rethumbBtn) {
      rethumbBtn.disabled = !authenticated;
      rethumbBtn.classList.toggle("ghosted", !authenticated);
    }
    signinBtn.style.display = authenticated ? "none" : "";
    // The "Restart Dubber service" control is an operator action -- only show
    // it once signed in (same gate as the dubbing buttons).
    if (serviceControls) serviceControls.style.display = authenticated ? "block" : "none";
  }

  async function checkAuth() {
    try {
      const res = await fetch(`${API_BASE}/healthz`, { credentials: "same-origin" });
      if (res.ok) {
        setAuthState("unlocked", "Signed in — dubbing is enabled.");
        loadExistingJobs();
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
    // Spanish sharing the rest with Spanish ~20% wider (see style.css). A
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

    // Sizes a Spanish textarea to fit its own content (no inner scrollbar --
    // translations commonly run longer than the English they came from, so
    // simply matching the Original cell's height isn't enough to show it all)
    // while never going shorter than the Original cell beside it, so the box
    // still "goes down at least as far as" the English text when its own
    // content happens to be shorter.
    function syncTextareaHeight(textarea, origText) {
      const minHeight = origText ? Math.ceil(origText.getBoundingClientRect().height) : 0;
      textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight)}px`;
    }

    const editPairs = []; // { textarea, origText } -- origText is null when there's no Original column

    const tbody = document.createElement("tbody");
    rows.forEach((row, index) => {
      const tr = document.createElement("tr");

      const timeCell = document.createElement("td");
      timeCell.className = "transcript-time";
      timeCell.textContent = formatTimestamp(row.start);
      tr.appendChild(timeCell);

      let origText = null;
      if (hasOriginal) {
        const origCell = document.createElement("td");
        origCell.className = "transcript-original";
        // The text lives in its own block so its measured height reflects
        // only its own content/column-width -- NOT the row's height. (If we
        // measured the <td> itself, growing the textarea would grow the row,
        // which stretches the <td>, which would feed back into the textarea
        // height again -- an infinite loop that once blew a box up to
        // full-page height.)
        origText = document.createElement("div");
        origText.textContent = row.original_text || "";
        origCell.appendChild(origText);
        tr.appendChild(origCell);
      }

      const esCell = document.createElement("td");
      esCell.className = "transcript-translated";

      const editRow = document.createElement("div");
      editRow.className = "transcript-edit";

      const textarea = document.createElement("textarea");
      textarea.value = row.translated_text || "";
      textarea.setAttribute("aria-label", `Edit the Spanish line at ${formatTimestamp(row.start)}`);
      editPairs.push({ textarea, origText });

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn secondary transcript-save";
      saveBtn.textContent = "Save";

      textarea.addEventListener("input", () => {
        window.clearTimeout(saveBtn._resetTimer);
        saveBtn.textContent = "Save";
        esCell.classList.remove("saved");
        esCell.classList.add("dirty");
        syncTextareaHeight(textarea, origText);
      });
      saveBtn.addEventListener("click", () => {
        state.lines[index].text = textarea.value;
        esCell.classList.remove("dirty");
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

    // Initial sizing pass, once the table has actually been laid out (so
    // scrollHeight/getBoundingClientRect reflect real wrapped-text heights).
    window.requestAnimationFrame(() => {
      editPairs.forEach(({ textarea, origText }) => syncTextareaHeight(textarea, origText));
    });

    // Re-sync as the page resizes and Original cells rewrap to new widths.
    if (hasOriginal && typeof ResizeObserver !== "undefined") {
      const pairByOrigText = new Map(editPairs.map((pair) => [pair.origText, pair]));
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const pair = pairByOrigText.get(entry.target);
          if (pair) syncTextareaHeight(pair.textarea, pair.origText);
        }
      });
      editPairs.forEach(({ origText }) => { if (origText) resizeObserver.observe(origText); });
    }

    const editHint = document.createElement("p");
    editHint.className = "hint";
    editHint.textContent = "Tweak any Spanish line above and click its Save button. Saved " +
      "lines for this same video and language are used automatically -- in place of a fresh " +
      "translation -- the next time you click “Start dubbing”.";
    wrap.appendChild(editHint);

    return wrap;
  }

  // --- Job progress bar helpers ------------------------------------------
  // The dubber reports progress_pct (0-100) alongside the stage/message; these
  // turn it into a bar that keeps moving through the slow stages.
  function jobPercent(job) {
    if (typeof job.progress_pct === "number") return Math.max(0, Math.min(100, job.progress_pct));
    return job.status === "done" ? 100 : 0;
  }

  function progressState(job) {
    if (job.status === "done") return "done";
    if (job.status === "failed") return "failed";
    if (job.status === "cancelled") return "cancelled";
    if (job.status === "running") return "running";
    return "queued";
  }

  function formatElapsed(job) {
    const start = Date.parse(job.created_at);
    if (isNaN(start)) return "";
    const endRaw = TERMINAL.has(job.status) ? Date.parse(job.updated_at) : Date.now();
    const end = isNaN(endRaw) ? Date.now() : endRaw;
    const secs = Math.max(0, Math.round((end - start) / 1000));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function buildProgressBar(job) {
    const wrap = document.createElement("div");
    wrap.className = "job-progress " + progressState(job);
    const track = document.createElement("div");
    track.className = "job-progress-track";
    const fill = document.createElement("div");
    fill.className = "job-progress-fill";
    fill.style.width = jobPercent(job) + "%";
    track.appendChild(fill);
    wrap.appendChild(track);
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
    headline.className = "job-headline";

    const left = document.createElement("span");
    const idLabel = document.createElement("span");
    idLabel.className = "job-id";
    idLabel.textContent = `Job ${job.id} — `;
    const stage = document.createElement("span");
    stage.className = "job-stage";
    const stagePrefix = job.mode === "preview" ? "[preview] " : "";
    stage.textContent = stagePrefix + (job.stage || job.status);
    left.appendChild(idLabel);
    left.appendChild(stage);
    headline.appendChild(left);

    const right = document.createElement("span");
    right.className = "job-headline-right";

    // Percent readout for jobs that are working or have a meaningful figure.
    if (job.status === "running" || job.status === "done" ||
        (job.status === "failed" && typeof job.progress_pct === "number")) {
      const pct = document.createElement("span");
      pct.className = "job-pct";
      pct.textContent = Math.round(jobPercent(job)) + "%";
      right.appendChild(pct);
    }

    // A still-queued job hasn't been claimed by the worker yet, so it's safe to
    // cancel outright. (Running jobs are mid-pipeline; see the DELETE endpoint.)
    if (job.status === "queued") {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn secondary job-cancel";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => cancelJob(job.id, cancelBtn));
      right.appendChild(cancelBtn);
    }
    headline.appendChild(right);
    card.appendChild(headline);

    // Progress bar -- skipped only for a finished preview, which renders its
    // transcript table instead.
    if (!(job.mode === "preview" && job.status === "done")) {
      card.appendChild(buildProgressBar(job));
    }

    if (job.progress) {
      const progress = document.createElement("div");
      progress.className = "hint job-detail";
      progress.textContent = job.progress;
      card.appendChild(progress);
    }

    // Elapsed time while active; final duration once finished (dub jobs only --
    // a preview is quick and shows its table instead).
    if (job.status === "running" || job.status === "queued" ||
        (TERMINAL.has(job.status) && job.mode !== "preview")) {
      const elapsed = formatElapsed(job);
      if (elapsed) {
        const meta = document.createElement("div");
        meta.className = "job-meta";
        meta.textContent = (TERMINAL.has(job.status) ? "took " : "elapsed ") + elapsed;
        card.appendChild(meta);
      }
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

  const TERMINAL = new Set(["done", "failed", "cancelled"]);

  function pollJob(jobId) {
    if (pollTimers.has(jobId)) return;

    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/jobs/${jobId}`, { credentials: "same-origin" });
        if (!res.ok) return;
        const job = await res.json();
        renderJob(job);
        if (TERMINAL.has(job.status)) {
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

  async function cancelJob(jobId, button) {
    if (button) {
      button.disabled = true;
      button.textContent = "Cancelling…";
    }
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // 409: the worker claimed it first, so it's running now. Re-render
        // from the returned state so the (now ineligible) button disappears.
        if (button) {
          button.disabled = false;
          button.textContent = "Cancel";
        }
        const detail = data && (data.detail || data.message);
        if (res.status === 409) {
          // Refresh this job so its card reflects the real (running/…) state.
          pollJob(jobId);
        } else if (formMessage) {
          formMessage.textContent = `Couldn't cancel job ${jobId}: ` +
            (typeof detail === "string" ? detail : `HTTP ${res.status}`);
        }
        return;
      }
      // Cancelled: stop polling and re-render the card as cancelled.
      if (pollTimers.has(jobId)) {
        clearInterval(pollTimers.get(jobId));
        pollTimers.delete(jobId);
      }
      if (data) renderJob(data);
    } catch (err) {
      if (button) {
        button.disabled = false;
        button.textContent = "Cancel";
      }
    }
  }

  // On sign-in, surface jobs that already exist on the server (e.g. a queued
  // job left from an earlier visit) so they can be tracked -- and cancelled --
  // without having to be the one who submitted them this session.
  async function loadExistingJobs() {
    try {
      const res = await fetch(`${API_BASE}/jobs`, { credentials: "same-origin" });
      if (!res.ok) return;
      const jobs = await res.json();
      if (!Array.isArray(jobs)) return;
      // Render oldest-first so prepend() leaves newest on top, matching submit order.
      jobs.slice().reverse().forEach((job) => {
        renderJob(job);
        if (!TERMINAL.has(job.status)) pollJob(job.id);
      });
    } catch (err) {
      /* non-fatal: the panel still works for newly submitted jobs */
    }
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
    let usingThumbnail = false;
    const dubThumb = dubThumbEditor.getState();
    if (mode === "dub" && dubThumb && dubThumb.approved &&
        dubThumb.url === url && dubThumb.targetLanguage === targetLanguage) {
      payload.thumbnail_override = dubThumb.generated;
      usingThumbnail = true;
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

      const thumbNote = usingThumbnail ? " Your approved thumbnail will be applied." : "";
      formMessage.textContent = (mode === "preview"
        ? `Queued transcript preview as job ${data.id}. Tracking progress below.`
        : (usingSavedEdits
            ? `Queued as job ${data.id} — it will use your saved transcript edits. Tracking progress below.`
            : `Queued as job ${data.id}. Tracking progress below.`)) + thumbNote;
      if (mode !== "preview") {
        form.reset();
        dubThumbEditor.reset();
      }
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

  // --- Restart Dubber service --------------------------------------------
  // POSTs to the service's /admin/restart endpoint, which exits the process so
  // systemd respawns it. That's the catch-all reset: it frees the service's
  // memory and stops any running job. The endpoint sits behind the same Basic
  // Auth as the rest of /dubber/api/, so only signed-in operators can hit it.

  async function waitForServiceBack(attempt) {
    attempt = attempt || 0;
    try {
      const res = await fetch(`${API_BASE}/healthz`, { credentials: "same-origin" });
      if (res.ok) {
        restartMessage.textContent = "Service restarted ✓";
        restartBtn.disabled = false;
        restartBtn.classList.remove("ghosted");
        window.setTimeout(() => { restartMessage.textContent = ""; }, 3000);
        // Any job left 'running' is reconciled on startup -- refresh the list.
        loadExistingJobs();
        return;
      }
    } catch (err) {
      /* upstream still down (proxy 502 / connection refused) -- keep waiting */
    }
    if (attempt < 12) {
      window.setTimeout(() => waitForServiceBack(attempt + 1), 1500);
    } else {
      restartMessage.textContent = "Service is taking longer than expected to come back — check the server.";
      restartBtn.disabled = false;
      restartBtn.classList.remove("ghosted");
    }
  }

  async function restartService() {
    if (!authenticated) return;
    const ok = window.confirm(
      "Restart the dubber service now?\n\n" +
      "This frees the server's memory and STOPS any job that is currently " +
      "running. Queued jobs are kept and resume afterward."
    );
    if (!ok) return;

    restartBtn.disabled = true;
    restartBtn.classList.add("ghosted");
    restartMessage.textContent = "Restarting…";
    try {
      const res = await fetch(`${API_BASE}/admin/restart`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        restartMessage.textContent = `Restart request failed (HTTP ${res.status}).`;
        restartBtn.disabled = false;
        restartBtn.classList.remove("ghosted");
        return;
      }
    } catch (err) {
      /* The process can drop the connection as it exits before the response
         is read; that's expected -- fall through and wait for it to come back. */
    }
    restartMessage.textContent = "Restarting — the service will be back in a few seconds…";
    window.setTimeout(() => waitForServiceBack(0), 4000);
  }

  if (restartBtn) restartBtn.addEventListener("click", restartService);

  // --- Thumbnail editor (shared) -----------------------------------------
  // A reusable preview/edit widget over /thumbnail/preview + /thumbnail/render:
  // shows the source thumbnail beside a Spanish version (baked-in text detected,
  // translated and re-rendered, banner on top), with the per-region translations
  // editable. Two instances use it -- the dub flow (an approved image is carried
  // into the upload as `thumbnail_override`, read by submitJob) and the
  // standalone re-thumbnail tool (an approved image is pushed onto an existing
  // video via /thumbnail/apply). Each scopes its DOM lookups to its own panel so
  // the two never collide.
  function makeThumbnailEditor(opts) {
    let state = null;

    function getState() { return state; }

    function reset() {
      state = null;
      if (opts.panel) {
        opts.panel.style.display = "none";
        opts.panel.textContent = "";
      }
    }

    function setMessage(text, kind) {
      const msg = opts.panel.querySelector(".thumb-message");
      if (!msg) return;
      msg.textContent = text || "";
      msg.className = "hint thumb-message" + (kind ? " " + kind : "");
    }

    function markApproved() {
      const fig = opts.panel.querySelector(".thumb-generated-figure");
      if (fig) fig.classList.add("approved");
    }

    function figure(label, src) {
      const fig = document.createElement("figure");
      fig.className = "thumb-figure";
      const img = document.createElement("img");
      img.className = "thumb-img";
      img.src = src;
      img.alt = label + " thumbnail";
      const cap = document.createElement("figcaption");
      cap.textContent = label;
      fig.appendChild(img);
      fig.appendChild(cap);
      return fig;
    }

    async function preview() {
      if (!authenticated) return;
      const url = opts.getSourceUrl();
      if (!url) {
        opts.onMissingSource();
        return;
      }
      const targetLanguage = opts.getTargetLanguage();

      const restore = opts.trigger.textContent;
      opts.trigger.disabled = true;
      opts.trigger.textContent = "Fetching thumbnail…";
      opts.panel.style.display = "block";
      opts.panel.textContent = "";
      const loading = document.createElement("p");
      loading.className = "hint";
      loading.textContent = "Fetching the thumbnail and generating the Spanish version… " +
        "(the first one can take a few seconds while the text models warm up).";
      opts.panel.appendChild(loading);

      try {
        const res = await fetch(`${API_BASE}/thumbnail/preview`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url, target_language: targetLanguage }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const detail = data && (data.detail || data.message);
          opts.panel.textContent = "";
          const err = document.createElement("p");
          err.className = "hint";
          err.textContent = "Couldn't generate a thumbnail preview: " +
            (typeof detail === "string" ? detail : `HTTP ${res.status}`);
          opts.panel.appendChild(err);
          return;
        }
        state = {
          url: url,
          targetLanguage: targetLanguage,
          original: data.original,
          generated: data.generated,
          regions: data.regions || [],
          bannerText: data.banner_text || "",
          approved: false,
        };
        render(data);
      } catch (err) {
        opts.panel.textContent = "";
        const e = document.createElement("p");
        e.className = "hint";
        e.textContent = "Couldn't reach the dubber service.";
        opts.panel.appendChild(e);
      } finally {
        opts.trigger.disabled = !authenticated;
        opts.trigger.textContent = restore;
      }
    }

    function render(data) {
      opts.panel.textContent = "";

      const title = document.createElement("div");
      title.className = "service-title";
      title.textContent = opts.title;
      opts.panel.appendChild(title);

      const compare = document.createElement("div");
      compare.className = "thumb-compare";
      compare.appendChild(figure("Original", data.original));
      const generatedFig = figure("Spanish version", data.generated);
      generatedFig.classList.add("thumb-generated-figure");
      compare.appendChild(generatedFig);
      opts.panel.appendChild(compare);

      const regions = data.regions || [];
      const inputs = []; // { polygon, input }

      if (regions.length) {
        const intro = document.createElement("p");
        intro.className = "hint";
        intro.textContent = "Detected text and its translation. Edit the text, font, or " +
          "colour of any line (the font/colour pre-fill with what was detected — change them " +
          "if it guessed wrong), then re-render to preview your changes.";
        opts.panel.appendChild(intro);

        const list = document.createElement("div");
        list.className = "thumb-regions";
        regions.forEach((region) => {
          const row = document.createElement("div");
          row.className = "thumb-region";

          const orig = document.createElement("span");
          orig.className = "thumb-region-original";
          orig.textContent = region.text;
          row.appendChild(orig);

          const arrow = document.createElement("span");
          arrow.className = "thumb-region-arrow";
          arrow.textContent = "→";
          row.appendChild(arrow);

          const input = document.createElement("input");
          input.type = "text";
          input.className = "thumb-region-input";
          input.value = region.translation;
          input.setAttribute("aria-label", `Spanish text for “${region.text}”`);
          input.addEventListener("input", markDirty);
          row.appendChild(input);

          // Per-line font + colour overrides. They pre-fill with what the
          // detector matched; correct them when it guessed wrong, then re-render.
          const style = document.createElement("span");
          style.className = "thumb-region-style";

          const fontSelect = document.createElement("select");
          fontSelect.className = "thumb-region-font";
          [["auto", "Auto font"], ["serif", "Serif"], ["sans", "Sans-serif"]].forEach(([val, label]) => {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = label;
            fontSelect.appendChild(opt);
          });
          fontSelect.value = (region.font_family === "serif" || region.font_family === "sans")
            ? region.font_family : "auto";
          fontSelect.setAttribute("aria-label", `Font for “${region.text}”`);
          fontSelect.addEventListener("change", markDirty);
          style.appendChild(fontSelect);

          const colorInput = document.createElement("input");
          colorInput.type = "color";
          colorInput.className = "thumb-region-color";
          colorInput.value = /^#[0-9a-fA-F]{6}$/.test(region.fill_color || "")
            ? region.fill_color : "#ffffff";
          colorInput.title = "Text colour";
          colorInput.setAttribute("aria-label", `Text colour for “${region.text}”`);
          colorInput.addEventListener("input", markDirty);
          style.appendChild(colorInput);

          row.appendChild(style);

          inputs.push({
            polygon: region.polygon, input: input,
            fontSelect: fontSelect, colorInput: colorInput,
          });
          list.appendChild(row);
        });
        opts.panel.appendChild(list);
      } else {
        const none = document.createElement("p");
        none.className = "hint";
        none.textContent = "No text was detected in the thumbnail to translate — only the " +
          "banner will be added.";
        opts.panel.appendChild(none);
      }

      const actions = document.createElement("div");
      actions.className = "thumb-actions";

      if (regions.length) {
        const rerenderBtn = document.createElement("button");
        rerenderBtn.type = "button";
        rerenderBtn.className = "btn secondary";
        rerenderBtn.textContent = "Re-render with edits";
        rerenderBtn.addEventListener("click", () => rerender(inputs, rerenderBtn));
        actions.appendChild(rerenderBtn);
      }

      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "btn thumb-action";
      actionBtn.textContent = opts.actionLabel;
      actionBtn.addEventListener("click", () =>
        opts.onAction({ state: state, button: actionBtn, setMessage: setMessage, markApproved: markApproved }));
      actions.appendChild(actionBtn);

      const msg = document.createElement("span");
      msg.className = "hint thumb-message";
      actions.appendChild(msg);

      opts.panel.appendChild(actions);
    }

    // An edit invalidates the rendered image: drop approval and disable the
    // action until a re-render, so what's used always matches the edited text.
    function markDirty() {
      if (state) state.approved = false;
      const actionBtn = opts.panel.querySelector(".thumb-action");
      if (actionBtn) actionBtn.disabled = true;
      const fig = opts.panel.querySelector(".thumb-generated-figure");
      if (fig) fig.classList.remove("approved");
      setMessage("You have unrendered edits — click “Re-render with edits” to preview them.");
    }

    async function rerender(inputs, button) {
      if (!state) return;
      const regions = inputs.map(({ polygon, input, fontSelect, colorInput }) => ({
        polygon: polygon,
        translation: input.value,
        font_family: fontSelect ? fontSelect.value : "auto",  // "auto" -> server auto-detects
        fill_color: colorInput ? colorInput.value : null,     // "#rrggbb"
      }));
      const restore = button.textContent;
      button.disabled = true;
      button.textContent = "Rendering…";
      setMessage("Rendering…");
      try {
        const res = await fetch(`${API_BASE}/thumbnail/render`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            original: state.original,
            regions: regions,
            banner_text: state.bannerText,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.generated) {
          setMessage("Couldn't re-render the thumbnail.", "bad");
          return;
        }
        state.generated = data.generated;
        const img = opts.panel.querySelector(".thumb-generated-figure img");
        if (img) img.src = data.generated;
        const actionBtn = opts.panel.querySelector(".thumb-action");
        if (actionBtn) actionBtn.disabled = false;
        setMessage("Updated. Use it as is, or keep editing.");
      } catch (err) {
        setMessage("Couldn't reach the dubber service.", "bad");
      } finally {
        button.disabled = false;
        button.textContent = restore;
      }
    }

    return { preview: preview, reset: reset, getState: getState };
  }

  // The dub flow's editor: approving carries the exact image into the upload as
  // `thumbnail_override` (read by submitJob). Optional -- skip it and the
  // pipeline auto-generates one.
  const dubThumbEditor = makeThumbnailEditor({
    panel: thumbnailPanel,
    trigger: thumbnailBtn,
    title: "Thumbnail preview",
    actionLabel: "Use this thumbnail for the dub",
    getSourceUrl: () => document.getElementById("video-url").value.trim(),
    getTargetLanguage: () => document.getElementById("target-lang").value,
    onMissingSource: () => { formMessage.textContent = "Enter a video URL first."; },
    onAction: ({ state, setMessage, markApproved }) => {
      state.approved = true;
      markApproved();
      setMessage("✓ This thumbnail will be used when you start dubbing this video.", "good");
    },
  });
  thumbnailBtn.addEventListener("click", () => dubThumbEditor.preview());

  // --- Re-thumbnail an existing video ------------------------------------
  // The same generate/translate/edit widget, but the approved image is pushed
  // straight onto an existing video on the connected channel via
  // /thumbnail/apply, instead of being held for an upload.
  function setRethumbMessage(text, kind) {
    if (!rethumbMessage) return;
    rethumbMessage.textContent = text || "";
    rethumbMessage.className = "hint" + (kind ? " thumb-message " + kind : "");
  }

  async function applyThumbnailToTarget({ state, button, setMessage, markApproved }) {
    const target = document.getElementById("rethumb-url").value.trim();
    if (!target) {
      setMessage("Enter the target video URL above first.", "bad");
      return;
    }
    const restore = button.textContent;
    button.disabled = true;
    button.textContent = "Applying…";
    setMessage("Pushing the thumbnail to the target video…");
    try {
      const res = await fetch(`${API_BASE}/thumbnail/apply`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_url: target, thumbnail: state.generated }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = data && (data.detail || data.message);
        setMessage("Couldn't update the thumbnail: " +
          (typeof detail === "string" ? detail : `HTTP ${res.status}`), "bad");
        return;
      }
      markApproved();
      setMessage("✓ Updated the thumbnail on " + (data.video_url || "the target video") + ".", "good");
    } catch (err) {
      setMessage("Couldn't reach the dubber service.", "bad");
    } finally {
      button.disabled = false;
      button.textContent = restore;
    }
  }

  const rethumbEditor = makeThumbnailEditor({
    panel: rethumbPreview,
    trigger: rethumbBtn,
    title: "New thumbnail preview",
    actionLabel: "Apply to the target video",
    getSourceUrl: () => document.getElementById("video-url").value.trim(),
    getTargetLanguage: () => document.getElementById("target-lang").value,
    onMissingSource: () => setRethumbMessage("Enter the English source video URL (above) first.", "bad"),
    onAction: applyThumbnailToTarget,
  });
  if (rethumbBtn) {
    rethumbBtn.addEventListener("click", () => {
      const target = document.getElementById("rethumb-url").value.trim();
      if (!target) {
        rethumbEditor.reset();
        setRethumbMessage("Enter the target video URL first.", "bad");
        return;
      }
      setRethumbMessage("");
      rethumbEditor.preview();
    });
  }

  // A different source video or language makes any rendered preview stale --
  // clear both editors so neither shows a thumbnail that no longer matches.
  function maybeResetStaleThumbnails() {
    const url = document.getElementById("video-url").value.trim();
    const lang = document.getElementById("target-lang").value;
    [dubThumbEditor, rethumbEditor].forEach((editor) => {
      const st = editor.getState();
      if (st && (url !== st.url || lang !== st.targetLanguage)) editor.reset();
    });
  }
  document.getElementById("video-url").addEventListener("input", maybeResetStaleThumbnails);
  document.getElementById("target-lang").addEventListener("change", maybeResetStaleThumbnails);

  checkAuth();
})();

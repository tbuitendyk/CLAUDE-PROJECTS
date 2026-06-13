/* Spanish Video Dubber control panel.
 *
 * Talks to the youtube-spanish-dubber HTTP API through nginx's
 * `/dubber/api/` reverse-proxy location, which is protected with HTTP Basic
 * Auth (see ../../nginx/www.buitendyk.ca.conf). The browser's native auth
 * prompt -- triggered the first time a request gets a 401 -- is the "sign
 * in"; once credentials are cached for this origin, every request below
 * carries them automatically.
 *
 * The mental model (matches the backend's library):
 *  - The LIBRARY holds one entry per (source video, language), ever: draft ->
 *    published -> published-with-pending-edits (a redub in progress).
 *  - Saves (transcript lines, thumbnail) write the entry's draft server-side,
 *    so edits survive reloads; "Start dubbing" speaks what the library holds.
 *  - The ACTIVITY LOG is permanent and append-only: one timestamped line per
 *    action, never any transcript content. Live progress cards appear above
 *    it only while a job is queued/running.
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
  const lookupBanner = document.getElementById("lookup-banner");
  const jobList = document.getElementById("job-list");
  const serviceControls = document.getElementById("service-controls");
  const restartBtn = document.getElementById("restart-btn");
  const restartMessage = document.getElementById("restart-message");
  const thumbnailBtn = document.getElementById("thumbnail-btn");
  const thumbnailPanel = document.getElementById("thumbnail-panel");
  const transcriptPanel = document.getElementById("transcript-panel");
  const rethumbBtn = document.getElementById("rethumb-btn");
  const rethumbTarget = document.getElementById("rethumb-target");
  const rethumbOtherUrl = document.getElementById("rethumb-other-url");
  const rethumbPreview = document.getElementById("rethumb-preview");
  const rethumbMessage = document.getElementById("rethumb-message");
  const libraryPanel = document.getElementById("library-panel");
  const libraryList = document.getElementById("library-list");
  const logPanel = document.getElementById("log-panel");
  const eventList = document.getElementById("event-list");

  let authenticated = false;
  const pollTimers = new Map(); // job id -> setInterval handle
  let libraryItems = [];        // project summaries from GET /projects
  let currentProject = null;    // the entry matching the form's URL + language
  let autoOpenedFor = null;     // project id whose saved cards we already auto-opened

  // --- Small helpers -------------------------------------------------------

  function videoIdOf(urlOrId) {
    const value = (urlOrId || "").trim();
    if (/^[\w\-]{11}$/.test(value)) return value;
    const match = value.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([\w\-]{11})/);
    return match ? match[1] : null;
  }

  function formUrl() { return document.getElementById("video-url").value.trim(); }
  function formLang() { return document.getElementById("target-lang").value; }
  function formPrivacy() {
    const checked = document.querySelector('#privacy-radios input[name="privacy"]:checked');
    return checked ? checked.value : "unlisted";
  }

  async function api(path, options) {
    const res = await fetch(`${API_BASE}${path}`, Object.assign({ credentials: "same-origin" }, options || {}));
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data && (data.detail || data.message);
      const err = new Error(typeof detail === "string" ? detail : `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function apiJson(path, method, body) {
    return api(path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // Every button press leaves a line in the permanent log. Server-backed
  // actions log themselves; this records the client-side-only ones.
  function logClientEvent(action, videoTitle, detail) {
    apiJson("/events", "POST", {
      action: action,
      video_title: videoTitle || null,
      detail: detail || null,
    }).then(loadEvents).catch(() => { /* best-effort */ });
  }

  // Get-or-create THE library entry for the form's video + language (needed
  // before the first draft save for a brand-new video).
  async function ensureProject(url, lang) {
    if (currentProject && videoIdOf(url) === currentProject.source_video_id &&
        lang === currentProject.target_language) {
      return currentProject;
    }
    currentProject = await apiJson("/projects", "POST", { url: url, target_language: lang });
    return currentProject;
  }

  function setAuthState(state, text) {
    authDot.className = "dot " + state;
    authText.textContent = text;
    authenticated = state === "unlocked";
    [submitBtn, previewBtn, thumbnailBtn, rethumbBtn].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !authenticated;
      btn.classList.toggle("ghosted", !authenticated);
    });
    signinBtn.style.display = authenticated ? "none" : "";
    // Operator features share the same auth gate.
    if (serviceControls) serviceControls.style.display = authenticated ? "block" : "none";
    if (libraryPanel) libraryPanel.style.display = authenticated ? "block" : "none";
    if (logPanel) logPanel.style.display = authenticated ? "block" : "none";
  }

  async function checkAuth() {
    try {
      const res = await fetch(`${API_BASE}/healthz`, { credentials: "same-origin" });
      if (res.ok) {
        setAuthState("unlocked", "Signed in — dubbing is enabled.");
        loadExistingJobs();
        loadLibrary();
        loadEvents();
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

  // --- URL re-entry: recognise a video the library already knows ----------

  let lookupTimer = null;

  function refreshLookup() {
    window.clearTimeout(lookupTimer);
    lookupTimer = window.setTimeout(doLookup, 350);
  }

  async function doLookup() {
    currentProject = null;
    lookupBanner.style.display = "none";
    lookupBanner.textContent = "";
    const url = formUrl();
    if (!authenticated || !videoIdOf(url)) {
      autoOpenedFor = null;  // URL cleared/invalid -> re-entering later re-opens
      return;
    }
    try {
      const summary = await api(`/projects/lookup?url=${encodeURIComponent(url)}&target_language=${encodeURIComponent(formLang())}`);
      currentProject = summary;
      renderLookupBanner(summary);
      maybeAutoOpenSavedCards(summary);
    } catch (err) {
      autoOpenedFor = null;  // 404 = a new video; nothing saved to re-open
    }
  }

  // Re-entering an English source URL the library already knows re-opens its
  // saved cards: the transcript preview card (from the saved draft) and the
  // thumbnail preview card (showing the saved image). Guarded by
  // `autoOpenedFor` so a card the user X-closes stays closed until they switch
  // to a different URL and come back.
  function maybeAutoOpenSavedCards(summary) {
    if (!summary || summary.id === autoOpenedFor) return;
    autoOpenedFor = summary.id;
    if (!summary.line_count && !summary.has_thumbnail) return;
    api(`/projects/${summary.id}`).then((project) => {
      if (project.rows && project.rows.length) {
        currentProject = project;
        renderTranscriptCard({
          rows: project.rows,
          sourceUrl: project.source_url,
          targetLanguage: project.target_language,
          summaryText: `${project.title || project.source_title || project.source_video_id}` +
            ` · ${project.line_count} lines · saved in the library`,
        });
      }
      if (project.thumbnail) dubThumbEditor.showSaved(project.thumbnail);
    }).catch(() => { /* non-fatal */ });
  }

  // An 'X' close control in a card's top-right: hides the card without
  // discarding what's saved (distinct from "Revert to default").
  function addCardCloseButton(panel, onClose) {
    panel.style.position = "relative";
    const x = document.createElement("button");
    x.type = "button";
    x.className = "card-close";
    x.setAttribute("aria-label", "Close");
    x.textContent = "×";
    x.addEventListener("click", onClose);
    panel.appendChild(x);
    return x;
  }

  function renderLookupBanner(entry) {
    lookupBanner.textContent = "";
    const label = entry.title || entry.source_title || entry.source_video_id;
    const strong = document.createElement("strong");
    if (entry.state === "draft") {
      strong.textContent = `“${label}” is already in the library as a draft`;
      lookupBanner.appendChild(strong);
      lookupBanner.appendChild(document.createTextNode(
        entry.line_count
          ? ` — its saved transcript (${entry.line_count} lines)${entry.has_thumbnail ? " and thumbnail" : ""} will be used when you start dubbing. `
          : ". "
      ));
    } else {
      strong.textContent = `“${label}” is already dubbed`;
      lookupBanner.appendChild(strong);
      lookupBanner.appendChild(document.createTextNode(" ("));
      const link = document.createElement("a");
      link.href = entry.target_url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "watch the dub";
      lookupBanner.appendChild(link);
      lookupBanner.appendChild(document.createTextNode(
        entry.state === "published_pending"
          ? ") — it has unapplied edits (a redub in progress). Dubbing again publishes a NEW video and repoints the entry. "
          : ") — dubbing again counts as a redub: a NEW video is published and the entry repoints to it. "
      ));
    }
    if (entry.line_count) {
      const open = document.createElement("a");
      open.href = "#";
      open.textContent = "Open its saved transcript";
      open.addEventListener("click", (e) => {
        e.preventDefault();
        openProjectTranscriptCard(entry.id);
      });
      lookupBanner.appendChild(open);
      lookupBanner.appendChild(document.createTextNode("."));
    }
    lookupBanner.style.display = "block";
  }

  document.getElementById("video-url").addEventListener("input", () => {
    refreshLookup();
    maybeResetStaleThumbnail();
  });
  document.getElementById("target-lang").addEventListener("change", () => {
    refreshLookup();
    maybeResetStaleThumbnail();
  });

  // --- THE transcript-editing table (shared by preview card + library) ----
  // `rows` are {start, end, original_text, translated_text}; `onSaveLine`
  // returns a Promise for server-backed saves. Returns { element, readLines }.
  function buildTranscriptTable(rows, onSaveLine) {
    const hasOriginal = rows.some((row) => row.original_text != null);

    const table = document.createElement("table");
    table.className = "transcript-table";
    table.classList.toggle("has-original", hasOriginal);

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

    // Sizes a Spanish textarea to fit its own content while never going
    // shorter than the Original cell beside it.
    function syncTextareaHeight(textarea, origText) {
      const minHeight = origText ? Math.ceil(origText.getBoundingClientRect().height) : 0;
      textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight)}px`;
    }

    const editPairs = []; // { textarea, origText }

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
        // The text lives in its own block so its measured height reflects only
        // its own content -- measuring the <td> would feed back into the
        // textarea height (a layout loop).
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

      function markSaved() {
        esCell.classList.remove("dirty");
        esCell.classList.add("saved");
        saveBtn.textContent = "Saved ✓";
        window.clearTimeout(saveBtn._resetTimer);
        saveBtn._resetTimer = window.setTimeout(() => { saveBtn.textContent = "Save"; }, 1500);
      }

      saveBtn.addEventListener("click", () => {
        const outcome = onSaveLine(index, textarea.value);
        if (outcome && typeof outcome.then === "function") {
          saveBtn.disabled = true;
          saveBtn.textContent = "Saving…";
          outcome.then(
            () => { saveBtn.disabled = false; markSaved(); },
            () => {
              saveBtn.disabled = false;
              saveBtn.textContent = "Couldn't save — retry";
              esCell.classList.remove("saved");
              esCell.classList.add("dirty");
            }
          );
        } else {
          markSaved();
        }
      });

      editRow.appendChild(textarea);
      editRow.appendChild(saveBtn);
      esCell.appendChild(editRow);
      tr.appendChild(esCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    window.requestAnimationFrame(() => {
      editPairs.forEach(({ textarea, origText }) => syncTextareaHeight(textarea, origText));
    });

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

    return {
      element: table,
      readLines: () => rows.map((row, i) => ({
        start: row.start,
        end: row.end,
        original_text: row.original_text != null ? row.original_text : null,
        translated_text: editPairs[i].textarea.value,
      })),
    };
  }

  // --- TRANSCRIPT PREVIEW card (under the project form) -------------------
  // One card, reused by: a finished "Preview transcript first" run, and
  // "Open its saved transcript" from the lookup banner. Per-line Save writes
  // the project's draft on the server; Revert to default restores the machine
  // transcript and closes the card. The card otherwise stays open -- even
  // through a publish; edits made then become the next redub's draft.
  function closeTranscriptCard() {
    transcriptPanel.style.display = "none";
    transcriptPanel.textContent = "";
  }

  function renderTranscriptCard(meta) {
    // meta: { rows, sourceUrl, targetLanguage, summaryText }
    transcriptPanel.textContent = "";
    transcriptPanel.style.display = "block";

    // 'X' hides the card but keeps the saved draft -- re-entering the URL
    // re-opens it (see maybeAutoOpenSavedCards).
    addCardCloseButton(transcriptPanel, () => {
      closeTranscriptCard();
      logClientEvent("Transcript preview closed",
        currentProject ? (currentProject.title || currentProject.source_title) : null);
    });

    const title = document.createElement("div");
    title.className = "service-title";
    title.textContent = "Transcript preview";
    transcriptPanel.appendChild(title);

    if (meta.summaryText) {
      const summary = document.createElement("div");
      summary.className = "hint";
      summary.textContent = meta.summaryText;
      transcriptPanel.appendChild(summary);
    }

    const rows = meta.rows || [];
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No transcript lines were produced.";
      transcriptPanel.appendChild(empty);
      return;
    }

    const built = buildTranscriptTable(rows, () => {
      // A line's Save commits the WHOLE current set as the project draft (the
      // server preserves the original-language side regardless).
      return ensureProject(meta.sourceUrl, meta.targetLanguage).then((project) =>
        apiJson(`/projects/${project.id}/transcript`, "PUT", { rows: built.readLines() })
      ).then((updated) => {
        currentProject = updated;
        loadLibrary();
        loadEvents();
      });
    });

    const scroll = document.createElement("div");
    scroll.className = "library-transcript-scroll";
    scroll.appendChild(built.element);
    transcriptPanel.appendChild(scroll);

    const actions = document.createElement("div");
    actions.className = "thumb-actions";

    const revertBtn = document.createElement("button");
    revertBtn.type = "button";
    revertBtn.className = "btn secondary";
    revertBtn.textContent = "Revert to default";
    revertBtn.addEventListener("click", async () => {
      revertBtn.disabled = true;
      try {
        if (currentProject && currentProject.id) {
          await api(`/projects/${currentProject.id}/transcript/revert`, { method: "POST" });
        }
        closeTranscriptCard();
        loadLibrary();
        loadEvents();
      } catch (err) {
        revertBtn.disabled = false;
      }
    });
    actions.appendChild(revertBtn);

    const hint = document.createElement("span");
    hint.className = "hint";
    hint.style.marginTop = "0";
    hint.textContent = "Each line's Save stores the draft in the library — “Start dubbing” " +
      "speaks the saved lines verbatim. Revert discards your edits and closes this card.";
    actions.appendChild(hint);
    transcriptPanel.appendChild(actions);
  }

  async function openProjectTranscriptCard(projectId) {
    try {
      const project = await api(`/projects/${projectId}`);
      currentProject = project;
      renderTranscriptCard({
        rows: project.rows,
        sourceUrl: project.source_url,
        targetLanguage: project.target_language,
        summaryText: `${project.title || project.source_title || project.source_video_id}` +
          ` · ${project.line_count} lines · saved in the library`,
      });
      transcriptPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      formMessage.textContent = "Couldn't load that project's transcript.";
    }
  }

  // --- Job progress (live status only) -------------------------------------
  function jobPercent(job) {
    if (typeof job.progress_pct === "number") return Math.max(0, Math.min(100, job.progress_pct));
    return job.status === "done" ? 100 : 0;
  }

  function progressState(job) {
    if (job.status === "running") return "running";
    return "queued";
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

  const TERMINAL = new Set(["done", "failed", "cancelled"]);

  function removeJobCard(jobId) {
    const card = document.getElementById(`job-${jobId}`);
    if (card) card.remove();
  }

  // Render a live progress card -- ONLY for jobs still queued/running.
  // Finished work shows up as activity-log lines instead.
  function renderJob(job) {
    if (TERMINAL.has(job.status)) {
      removeJobCard(job.id);
      return;
    }
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

    if (job.status === "running") {
      const pct = document.createElement("span");
      pct.className = "job-pct";
      pct.textContent = Math.round(jobPercent(job)) + "%";
      right.appendChild(pct);
    }

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

    card.appendChild(buildProgressBar(job));

    if (job.progress) {
      const progress = document.createElement("div");
      progress.className = "hint job-detail";
      progress.textContent = job.progress;
      card.appendChild(progress);
    }

    const start = Date.parse(job.created_at);
    if (!isNaN(start)) {
      const secs = Math.max(0, Math.round((Date.now() - start) / 1000));
      const meta = document.createElement("div");
      meta.className = "job-meta";
      meta.textContent = `elapsed ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      card.appendChild(meta);
    }

    return card;
  }

  function handleTerminalJob(job) {
    removeJobCard(job.id);
    loadEvents();
    loadLibrary();
    if (job.status === "failed" && job.error) {
      formMessage.textContent = `Job ${job.id} failed: ${job.error.split("\n")[0]}`;
    }
    if (job.mode === "preview" && job.status === "done" && job.result) {
      currentProject = null; // the entry just gained rows; refetch on demand
      renderTranscriptCard({
        rows: job.result.rows,
        sourceUrl: job.source_url,
        targetLanguage: job.target_language,
        summaryText: `Source: ${job.result.transcript_source}` +
          (job.result.original_language ? ` · original language: ${job.result.original_language}` : ""),
      });
      // The card opens up top (under the project form, beside the thumbnail
      // card's spot) -- bring it into view since the user was likely watching
      // the progress card further down.
      transcriptPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (job.mode !== "preview" && job.status === "done") {
      // Publish finished: the preview cards' job is done; close them. Edits
      // made after this point land on the entry as the next redub's draft.
      closeTranscriptCard();
      dubThumbEditor.reset();
      refreshLookup();
      if (job.youtube_video_url) {
        formMessage.textContent = `Published: ${job.youtube_video_url} — see the library and log below.`;
      }
    }
  }

  function pollJob(jobId) {
    if (pollTimers.has(jobId)) return;

    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/jobs/${jobId}`, { credentials: "same-origin" });
        if (!res.ok) return;
        const job = await res.json();
        if (TERMINAL.has(job.status)) {
          clearInterval(pollTimers.get(jobId));
          pollTimers.delete(jobId);
          handleTerminalJob(job);
        } else {
          renderJob(job);
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
        if (button) {
          button.disabled = false;
          button.textContent = "Cancel";
        }
        if (res.status === 409) {
          pollJob(jobId); // it started running; show the live card
        } else if (formMessage) {
          const detail = data && (data.detail || data.message);
          formMessage.textContent = `Couldn't cancel job ${jobId}: ` +
            (typeof detail === "string" ? detail : `HTTP ${res.status}`);
        }
        return;
      }
      if (pollTimers.has(jobId)) {
        clearInterval(pollTimers.get(jobId));
        pollTimers.delete(jobId);
      }
      removeJobCard(jobId);
      loadEvents();
    } catch (err) {
      if (button) {
        button.disabled = false;
        button.textContent = "Cancel";
      }
    }
  }

  // Surface still-active jobs from earlier visits (queued/running only --
  // finished history lives in the activity log).
  async function loadExistingJobs() {
    try {
      const res = await fetch(`${API_BASE}/jobs`, { credentials: "same-origin" });
      if (!res.ok) return;
      const jobs = await res.json();
      if (!Array.isArray(jobs)) return;
      jobs.slice().reverse().forEach((job) => {
        if (!TERMINAL.has(job.status)) {
          renderJob(job);
          pollJob(job.id);
        }
      });
    } catch (err) {
      /* non-fatal */
    }
  }

  async function submitJob(mode) {
    if (!authenticated) return;

    const url = formUrl();
    if (!url) {
      formMessage.textContent = "Enter a video URL first.";
      return;
    }
    const targetLanguage = formLang();
    const payload = { url: url, target_language: targetLanguage, mode: mode };
    if (mode === "dub") payload.privacy = formPrivacy();

    const hasDraft = currentProject && (currentProject.line_count > 0 || currentProject.has_thumbnail);
    formMessage.textContent = mode === "preview"
      ? "Submitting transcript preview…"
      : (hasDraft ? "Submitting — the library's saved draft will be used…" : "Submitting…");
    submitBtn.disabled = true;
    previewBtn.disabled = true;

    try {
      const data = await apiJson("/jobs", "POST", payload);
      formMessage.textContent = mode === "preview"
        ? `Queued transcript preview as job ${data.id}. Tracking progress below.`
        : `Queued as job ${data.id} (${payload.privacy}). Tracking progress below.`;
      renderJob(data);
      pollJob(data.id);
      loadEvents();
    } catch (err) {
      formMessage.textContent = `Couldn't submit the job: ${err.message}`;
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

  // --- Restart Dubber service ----------------------------------------------

  async function waitForServiceBack(attempt) {
    attempt = attempt || 0;
    try {
      const res = await fetch(`${API_BASE}/healthz`, { credentials: "same-origin" });
      if (res.ok) {
        restartMessage.textContent = "Service restarted ✓";
        restartBtn.disabled = false;
        restartBtn.classList.remove("ghosted");
        window.setTimeout(() => { restartMessage.textContent = ""; }, 3000);
        loadExistingJobs();
        loadEvents();
        return;
      }
    } catch (err) {
      /* upstream still down -- keep waiting */
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
      /* the process drops the connection as it exits; expected */
    }
    restartMessage.textContent = "Restarting — the service will be back in a few seconds…";
    window.setTimeout(() => waitForServiceBack(0), 4000);
  }

  if (restartBtn) restartBtn.addEventListener("click", restartService);

  // --- Thumbnail editor (shared widget) ------------------------------------
  // A preview/edit widget over /thumbnail/preview + /thumbnail/render. Two
  // instances: the dub flow (Save -> stored on the library entry) and the
  // re-thumbnail tool (Apply -> pushed onto an existing video). Both get a
  // "Revert to default" that discards and closes the card.
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

    // Hide the card without discarding it (the saved thumbnail stays on the
    // library entry). Re-entering the URL re-opens it via showSaved.
    function hide() {
      if (opts.panel) opts.panel.style.display = "none";
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
        const data = await apiJson("/thumbnail/preview", "POST",
          { url: url, target_language: targetLanguage });
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
        e.textContent = "Couldn't generate a thumbnail preview: " + err.message;
        opts.panel.appendChild(e);
      } finally {
        opts.trigger.disabled = !authenticated;
        opts.trigger.textContent = restore;
      }
    }

    function render(data) {
      opts.panel.textContent = "";

      addCardCloseButton(opts.panel, () => {
        hide();
        if (opts.onClose) opts.onClose(state);
      });

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
      const inputs = []; // { polygon, input, fontSelect, colorInput }

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

      const revertBtn = document.createElement("button");
      revertBtn.type = "button";
      revertBtn.className = "btn secondary";
      revertBtn.textContent = "Revert to default";
      revertBtn.addEventListener("click", () =>
        opts.onRevert({ state: state, button: revertBtn, reset: reset }));
      actions.appendChild(revertBtn);

      const msg = document.createElement("span");
      msg.className = "hint thumb-message";
      actions.appendChild(msg);

      opts.panel.appendChild(actions);
    }

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
        font_family: fontSelect ? fontSelect.value : "auto",
        fill_color: colorInput ? colorInput.value : null,
      }));
      const restore = button.textContent;
      button.disabled = true;
      button.textContent = "Rendering…";
      setMessage("Rendering…");
      try {
        const data = await apiJson("/thumbnail/render", "POST", {
          original: state.original,
          regions: regions,
          banner_text: state.bannerText,
        });
        if (!data || !data.generated) {
          setMessage("Couldn't re-render the thumbnail.", "bad");
          return;
        }
        state.generated = data.generated;
        const img = opts.panel.querySelector(".thumb-generated-figure img");
        if (img) img.src = data.generated;
        const actionBtn = opts.panel.querySelector(".thumb-action");
        if (actionBtn) actionBtn.disabled = false;
        setMessage("Updated. Save it as is, or keep editing.");
      } catch (err) {
        setMessage("Couldn't re-render the thumbnail: " + err.message, "bad");
      } finally {
        button.disabled = false;
        button.textContent = restore;
      }
    }

    // Re-open the card showing a thumbnail already saved on the library entry,
    // without re-fetching from YouTube. Read-only-ish: the saved image plus
    // Revert-to-default and the 'X'; "Preview thumbnail" re-fetches to re-edit.
    function showSaved(dataUri) {
      if (!dataUri || !opts.panel) return;
      state = {
        url: opts.getSourceUrl(), targetLanguage: opts.getTargetLanguage(),
        original: null, generated: dataUri, regions: [], bannerText: "",
        approved: true, savedOnly: true,
      };
      opts.panel.style.display = "block";
      opts.panel.textContent = "";
      addCardCloseButton(opts.panel, () => {
        hide();
        if (opts.onClose) opts.onClose(state);
      });

      const title = document.createElement("div");
      title.className = "service-title";
      title.textContent = opts.title;
      opts.panel.appendChild(title);

      const compare = document.createElement("div");
      compare.className = "thumb-compare";
      const fig = figure("Spanish version (saved)", dataUri);
      fig.classList.add("thumb-generated-figure", "approved");
      compare.appendChild(fig);
      opts.panel.appendChild(compare);

      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = "This thumbnail is saved with the project and applied automatically " +
        "when you dub. Click “Preview thumbnail” to re-edit it.";
      opts.panel.appendChild(note);

      const actions = document.createElement("div");
      actions.className = "thumb-actions";
      const revertBtn = document.createElement("button");
      revertBtn.type = "button";
      revertBtn.className = "btn secondary";
      revertBtn.textContent = "Revert to default";
      revertBtn.addEventListener("click", () =>
        opts.onRevert({ state: state, button: revertBtn, reset: reset }));
      actions.appendChild(revertBtn);
      const msg = document.createElement("span");
      msg.className = "hint thumb-message";
      actions.appendChild(msg);
      opts.panel.appendChild(actions);
    }

    return { preview: preview, reset: reset, getState: getState, showSaved: showSaved, hide: hide };
  }

  // The dub flow's editor: Save stores the image on the library entry (the
  // dub then uses it automatically); Revert to default clears any saved
  // thumbnail and closes the card (the pipeline auto-generates one again).
  const dubThumbEditor = makeThumbnailEditor({
    panel: thumbnailPanel,
    trigger: thumbnailBtn,
    title: "Thumbnail preview",
    actionLabel: "Save",
    getSourceUrl: formUrl,
    getTargetLanguage: formLang,
    onMissingSource: () => { formMessage.textContent = "Enter a video URL first."; },
    onClose: () => logClientEvent("Thumbnail preview closed",
      currentProject ? (currentProject.title || currentProject.source_title) : null),
    onAction: async ({ state, button, setMessage, markApproved }) => {
      const restore = button.textContent;
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        const project = await ensureProject(state.url, state.targetLanguage);
        const updated = await apiJson(`/projects/${project.id}/thumbnail`, "PUT",
          { thumbnail: state.generated });
        currentProject = Object.assign({}, currentProject, updated);
        state.approved = true;
        markApproved();
        setMessage("✓ Saved to the library — it will be used when you dub this video.", "good");
        loadLibrary();
        loadEvents();
      } catch (err) {
        setMessage("Couldn't save the thumbnail: " + err.message, "bad");
      } finally {
        button.disabled = false;
        button.textContent = restore;
      }
    },
    onRevert: async ({ state, button, reset }) => {
      button.disabled = true;
      try {
        if (currentProject && currentProject.id && currentProject.has_thumbnail) {
          await apiJson(`/projects/${currentProject.id}/thumbnail`, "PUT", { thumbnail: null });
          currentProject.has_thumbnail = false;
          loadLibrary();
          loadEvents();
        } else {
          logClientEvent("Thumbnail preview closed",
            state ? state.url : null, "reverted to default");
        }
      } catch (err) { /* still close */ }
      reset();
    },
  });
  thumbnailBtn.addEventListener("click", () => dubThumbEditor.preview());

  function maybeResetStaleThumbnail() {
    const st = dubThumbEditor.getState();
    if (st && (formUrl() !== st.url || formLang() !== st.targetLanguage)) dubThumbEditor.reset();
  }

  // --- Update an existing video's thumbnail (generalized) ------------------
  // Target = one of our published dubs (dropdown). The new thumbnail comes
  // from the entry's source video, the dub itself, or any other link.

  function setRethumbMessage(text, kind) {
    if (!rethumbMessage) return;
    rethumbMessage.textContent = text || "";
    rethumbMessage.className = "hint" + (kind ? " thumb-message " + kind : "");
  }

  function rethumbEntry() {
    return libraryItems.find((it) => it.id === rethumbTarget.value) || null;
  }

  function rethumbSourceChoice() {
    const checked = document.querySelector('#rethumb-source-radios input[name="rethumb-source"]:checked');
    return checked ? checked.value : "source";
  }

  function rethumbFromUrl() {
    const entry = rethumbEntry();
    const choice = rethumbSourceChoice();
    if (choice === "other") return rethumbOtherUrl.value.trim() || null;
    if (!entry) return null;
    if (choice === "dub") return entry.target_url;
    return entry.source_url;
  }

  document.querySelectorAll('#rethumb-source-radios input[name="rethumb-source"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      rethumbOtherUrl.style.display = rethumbSourceChoice() === "other" ? "block" : "none";
    });
  });

  function populateRethumbTargets() {
    const prev = rethumbTarget.value;
    rethumbTarget.textContent = "";
    const published = libraryItems.filter((it) => it.target_url);
    if (!published.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No published dubs yet";
      rethumbTarget.appendChild(opt);
      rethumbTarget.disabled = true;
      return;
    }
    rethumbTarget.disabled = false;
    published.forEach((it) => {
      const opt = document.createElement("option");
      opt.value = it.id;
      opt.textContent = it.title || it.source_title || it.target_video_id;
      if (it.id === prev) opt.selected = true;
      rethumbTarget.appendChild(opt);
    });
  }

  async function applyThumbnailToTarget({ state, button, setMessage, markApproved }) {
    const entry = rethumbEntry();
    if (!entry || !entry.target_url) {
      setMessage("Pick a published dub as the target first.", "bad");
      return;
    }
    const restore = button.textContent;
    button.disabled = true;
    button.textContent = "Applying…";
    setMessage("Pushing the thumbnail to the target video…");
    try {
      const data = await apiJson("/thumbnail/apply", "POST",
        { target_url: entry.target_url, thumbnail: state.generated });
      markApproved();
      setMessage("✓ Updated the thumbnail on " + (data.video_url || "the target video") + ".", "good");
      loadEvents();
    } catch (err) {
      setMessage("Couldn't update the thumbnail: " + err.message, "bad");
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
    getSourceUrl: rethumbFromUrl,
    getTargetLanguage: () => {
      const entry = rethumbEntry();
      return entry ? entry.target_language : formLang();
    },
    onMissingSource: () => setRethumbMessage(
      rethumbSourceChoice() === "other"
        ? "Enter the video link to take the thumbnail from."
        : "Pick a published dub as the target first.", "bad"),
    onAction: applyThumbnailToTarget,
    onRevert: ({ reset }) => {
      const entry = rethumbEntry();
      logClientEvent("Thumbnail update cancelled",
        entry ? (entry.title || entry.source_title) : null);
      reset();
    },
  });
  if (rethumbBtn) {
    rethumbBtn.addEventListener("click", () => {
      const entry = rethumbEntry();
      if (!entry || !entry.target_url) {
        rethumbEditor.reset();
        setRethumbMessage("Pick a published dub as the target first.", "bad");
        return;
      }
      setRethumbMessage("");
      rethumbEditor.preview();
    });
  }

  // --- Dub projects library -------------------------------------------------

  const STATE_LABELS = {
    draft: { text: "Draft — not published", className: "chip draft" },
    published: { text: "Published", className: "chip published" },
    published_pending: { text: "Redub in progress — unapplied edits", className: "chip pending" },
  };

  async function loadLibrary() {
    if (!authenticated) return;
    try {
      const items = await api("/projects");
      if (!Array.isArray(items)) return;
      libraryItems = items;
      renderLibrary(items);
      populateRethumbTargets();
    } catch (err) {
      /* non-fatal */
    }
  }

  function renderLibrary(items) {
    libraryList.textContent = "";
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No projects yet — previewing a transcript, saving a thumbnail, or " +
        "dubbing a video creates its entry here automatically.";
      libraryList.appendChild(empty);
      return;
    }
    items.forEach((item) => libraryList.appendChild(renderLibraryRow(item)));
  }

  function renderLibraryRow(item) {
    const row = document.createElement("div");
    row.className = "library-item";

    const head = document.createElement("div");
    head.className = "library-head";

    const name = document.createElement("div");
    name.className = "library-name";

    const chipInfo = STATE_LABELS[item.state] || STATE_LABELS.draft;
    const chip = document.createElement("span");
    chip.className = chipInfo.className;
    chip.textContent = chipInfo.text;
    name.appendChild(chip);

    const label = document.createElement("span");
    label.textContent = " " + (item.title || item.source_title || item.source_video_id);
    name.appendChild(label);

    const meta = document.createElement("span");
    meta.className = "library-meta";
    const bits = [`${item.line_count} lines`, item.target_language];
    if (item.voice) bits.push(item.voice);
    if (item.has_thumbnail) bits.push("custom thumbnail");
    if (item.has_bed) bits.push("audio bed cached");
    // Last-modified stamp; the server already lists entries newest-first by it.
    if (item.updated_at) bits.push("updated " + formatEventTime(item.updated_at));
    meta.textContent = ` ${bits.join(" · ")}`;
    name.appendChild(meta);

    const links = document.createElement("div");
    links.className = "library-links";
    const srcLink = document.createElement("a");
    srcLink.href = item.source_url; srcLink.target = "_blank"; srcLink.rel = "noopener";
    srcLink.textContent = "source video";
    links.appendChild(srcLink);
    if (item.target_url) {
      links.appendChild(document.createTextNode(" · "));
      const dubLink = document.createElement("a");
      dubLink.href = item.target_url; dubLink.target = "_blank"; dubLink.rel = "noopener";
      dubLink.textContent = "published dub";
      links.appendChild(dubLink);
    }
    name.appendChild(links);
    head.appendChild(name);

    const headBtns = document.createElement("div");
    headBtns.className = "library-head-buttons";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn secondary small";
    openBtn.textContent = "View / edit";
    headBtns.appendChild(openBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn danger small";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteEntry(item, deleteBtn));
    headBtns.appendChild(deleteBtn);

    head.appendChild(headBtns);
    row.appendChild(head);

    const body = document.createElement("div");
    body.className = "library-body";
    body.style.display = "none";
    row.appendChild(body);

    let loaded = false;
    openBtn.addEventListener("click", async () => {
      const open = body.style.display === "none";
      body.style.display = open ? "block" : "none";
      openBtn.textContent = open ? "Hide" : "View / edit";
      if (open && !loaded) {
        loaded = true;
        await openEntryBody(item, body);
      }
    });
    return row;
  }

  async function deleteEntry(item, button) {
    const label = item.title || item.source_title || item.source_video_id;
    const ok = window.confirm(
      `Delete “${label}” from the library?\n\n` +
      "Its transcript (including the original-language text) and cached audio " +
      "bed are removed for good. The published YouTube video itself is NOT " +
      "touched — channel cleanup stays manual."
    );
    if (!ok) return;
    button.disabled = true;
    try {
      await api(`/projects/${item.id}`, { method: "DELETE" });
      if (currentProject && currentProject.id === item.id) currentProject = null;
      loadLibrary();
      loadEvents();
      refreshLookup();
    } catch (err) {
      button.disabled = false;
      formMessage.textContent = `Couldn't delete that entry: ${err.message}`;
    }
  }

  async function openEntryBody(item, body) {
    body.textContent = "Loading…";
    let project;
    try {
      project = await api(`/projects/${item.id}`);
    } catch (err) {
      body.textContent = "Couldn't load the project.";
      return;
    }

    body.textContent = "";
    const rows = Array.isArray(project.rows) ? project.rows : [];
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No transcript yet — run “Preview transcript first” or a dub to fill it.";
      body.appendChild(empty);
      return;
    }

    // Same shared table as the preview card; a line's Save PUTs the whole
    // current set back as the entry's working transcript.
    const built = buildTranscriptTable(rows, () =>
      apiJson(`/projects/${item.id}/transcript`, "PUT", { rows: built.readLines() })
        .then(() => { loadLibrary(); loadEvents(); })
    );

    const scroll = document.createElement("div");
    scroll.className = "library-transcript-scroll";
    scroll.appendChild(built.element);
    body.appendChild(scroll);

    const actions = document.createElement("div");
    actions.className = "library-actions";

    // Redub: a fresh upload from the ORIGINAL source video speaking the saved
    // transcript, reusing the voice, thumbnail and cached audio bed. The entry
    // repoints to the new upload; the old dub stays on the channel for manual
    // cleanup.
    const redubBtn = document.createElement("button");
    redubBtn.type = "button";
    redubBtn.className = "btn small";
    redubBtn.textContent = item.target_url ? "Redub" : "Dub from this draft";

    const privacyWrap = document.createElement("span");
    privacyWrap.className = "radio-row inline";
    const radioName = `redub-privacy-${item.id}`;
    [["unlisted", "Unlisted", true], ["public", "Public", false]].forEach(([value, text, checked]) => {
      const radioLabel = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = radioName;
      radio.value = value;
      radio.checked = checked;
      radioLabel.appendChild(radio);
      radioLabel.appendChild(document.createTextNode(" " + text));
      privacyWrap.appendChild(radioLabel);
    });

    redubBtn.addEventListener("click", async () => {
      const checked = body.querySelector(`input[name="${radioName}"]:checked`);
      const privacy = checked ? checked.value : "unlisted";
      const label = item.title || item.source_title || item.source_video_id;
      const ok = window.confirm(
        `${item.target_url ? "Redub" : "Dub"} “${label}” as ${privacy}?\n\n` +
        "This publishes a NEW video from the original source, speaking the " +
        "saved transcript." + (item.target_url
          ? " The library entry will point at the new upload; the old dub " +
            "stays on the channel until you remove it yourself."
          : "")
      );
      if (!ok) return;
      redubBtn.disabled = true;
      try {
        const job = await apiJson(`/projects/${item.id}/redub`, "POST", { privacy: privacy });
        formMessage.textContent = `Queued ${item.target_url ? "redub" : "dub"} as job ${job.id} (${privacy}). Tracking progress below.`;
        renderJob(job);
        pollJob(job.id);
        loadEvents();
      } catch (err) {
        formMessage.textContent = `Couldn't start the redub: ${err.message}`;
      } finally {
        redubBtn.disabled = false;
      }
    });

    actions.appendChild(redubBtn);
    actions.appendChild(privacyWrap);

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "btn secondary small";
    dlBtn.textContent = "Download .txt";
    dlBtn.addEventListener("click", () => {
      downloadTranscript(project.title || project.source_title || item.id, built.readLines());
      logClientEvent("Transcript downloaded", project.title || project.source_title);
    });
    actions.appendChild(dlBtn);

    const hint = document.createElement("span");
    hint.className = "hint";
    hint.style.marginTop = "0";
    hint.textContent = "Each line's Save stores the edit on this entry; edited published " +
      "entries show as “Redub in progress” until you redub.";
    actions.appendChild(hint);
    body.appendChild(actions);
  }

  function downloadTranscript(title, lines) {
    const text = lines.map((r) => `[${formatTimestamp(r.start)} → ${formatTimestamp(r.end)}] ${r.translated_text}`);
    const blob = new Blob([text.join("\n") + "\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (title || "transcript").replace(/[^\w.-]+/g, "_").slice(0, 80) + ".txt";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // --- Activity log (permanent, append-only) -------------------------------

  let lastEventsRefresh = 0;

  async function loadEvents() {
    if (!authenticated) return;
    lastEventsRefresh = Date.now();
    try {
      const events = await api("/events?limit=200");
      if (!Array.isArray(events)) return;
      renderEvents(events);
    } catch (err) {
      /* non-fatal */
    }
  }

  function formatEventTime(iso) {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso || "";
    return date.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function renderEvents(events) {
    eventList.textContent = "";
    if (!events.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "Nothing yet — every action lands here, permanently.";
      eventList.appendChild(empty);
      return;
    }
    events.forEach((event) => {
      const line = document.createElement("div");
      line.className = "event-line";

      const time = document.createElement("span");
      time.className = "event-time";
      time.textContent = formatEventTime(event.created_at);
      line.appendChild(time);

      const action = document.createElement("span");
      action.className = "event-action";
      action.textContent = event.action;
      line.appendChild(action);

      if (event.video_title) {
        const title = document.createElement("span");
        title.className = "event-title";
        title.textContent = " — " + event.video_title;
        line.appendChild(title);
      }

      if (event.detail) {
        line.appendChild(document.createTextNode(" "));
        if (/^https?:\/\//.test(event.detail)) {
          const link = document.createElement("a");
          link.href = event.detail;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = event.detail;
          line.appendChild(link);
        } else {
          const detail = document.createElement("span");
          detail.className = "event-detail";
          detail.textContent = `(${event.detail})`;
          line.appendChild(detail);
        }
      }

      eventList.appendChild(line);
    });
  }

  // The log auto-refreshes once per minute whenever signed in -- server-side
  // lines (worker publishes/failures, one-shot maintenance passes) appear
  // without a reload. Action handlers still refresh immediately on top.
  window.setInterval(() => {
    if (authenticated && Date.now() - lastEventsRefresh > 55000) {
      loadEvents();
    }
  }, 60000);

  checkAuth();
})();

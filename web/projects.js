const PROJECT_NAME = /^[A-Z]+(?: [A-Z]+)*$/;

function keptProject(name) {
  return name === "FACTORY";
}

function readProjectName(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 16);
}

function occupiedNames(ignore) {
  const names = new Set();
  for (const library of [state.studioLibrary, state.cardLibrary]) {
    for (const item of library?.projects || []) {
      if (ignore && item.name === ignore) continue;
      names.add(item.name.toUpperCase());
    }
  }
  return names;
}

function projectNameError(next, action) {
  if (!PROJECT_NAME.test(next) || next.length > 16) {
    return "Use capital letters and spaces, up to 16 characters.";
  }
  if (action.mode === "duplicate" && next === action.project.toUpperCase()) {
    return "Type a different name.";
  }
  const ignore = action.mode === "rename" ? action.project : "";
  if (occupiedNames(ignore).has(next)) return "That name is already used.";
  return "";
}

function projectBody(extra) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(extra),
  };
}

async function loadLibraries() {
  const action = state.projectAction;
  await refreshPlaces();
  state.studioLibrary = await api(`/api/library?root=${encodeURIComponent(state.places.studio)}`);
  const drive = (state.places.drives || []).find((item) => item.path === state.places.card);
  state.cardLibrary = state.places.card && drive?.projects
    ? await api(`/api/library?root=${encodeURIComponent(state.places.card)}`)
    : null;
  if (state.projectPick?.place === "card") {
    const still = state.cardLibrary?.projects?.some((item) => item.name === state.projectPick.name);
    if (!still) state.projectPick = null;
  }
  if (state.projectName && state.root) {
    const openLibrary = state.root === state.places.card ? state.cardLibrary : state.studioLibrary;
    if (openLibrary) state.library = openLibrary;
  }
  state.projectAction = action;
  renderProjectMenu();
}

async function reloadProjects(message) {
  state.projectAction = null;
  await loadLibraries();
  setStatus(message, "ok");
}

function renderProjectMenu() {
  renderPlace("studio");
  renderPlace("card");
  paintPlaces();
}

function renderPlace(place) {
  const menu = $(place === "card" ? "card-projects" : "studio-projects");
  if (place === "card") {
    const drives = state.places?.drives || [];
    const drive = drives.find((item) => item.path === state.places?.card);
    if (!drives.length) {
      menu.innerHTML = `<p class="empty-sessions">No drives are connected.</p>`;
      return;
    }
    if (!drive) {
      menu.innerHTML = `<p class="empty-sessions">Choose a drive.</p>`;
      return;
    }
    if (!drive.projects) {
      menu.innerHTML = `<p class="empty-sessions">This drive has no sequencer projects.</p>`;
      return;
    }
  }
  const library = place === "card" ? state.cardLibrary : state.studioLibrary;
  const projects = library?.projects || [];
  if (!projects.length) {
    menu.innerHTML = `<p class="empty-sessions">No projects yet.</p>`;
    return;
  }
  menu.innerHTML = projects.map((item) => projectRow(item, place)).join("");
  const field = menu.querySelector("[name=next]");
  if (field && state.projectAction?.place === place) {
    field.focus();
    if (state.projectAction.draft) field.select();
  }
}

function projectRow(item, place) {
  const name = escapeHtml(item.name);
  const picked = state.projectPick?.place === place && state.projectPick?.name === item.name;
  const action = state.projectAction;
  if (action && action.place === place && action.project === item.name) {
    const label = action.mode === "rename" ? "Rename" : "Duplicate";
    return `<form class="project-row editing selected" data-project-form data-place="${place}" data-project="${name}">
      <input name="next" maxlength="16" required autocomplete="off" spellcheck="false" autocapitalize="characters" value="${escapeHtml(action.draft)}" placeholder="NEW NAME" aria-label="${label} ${name}">
      <button type="submit">${label}</button>
      <button type="button" data-project-cancel>Cancel</button>
    </form>`;
  }
  const legal = item.legal !== false;
  const nameTitle = legal ? "" : ` title="The sequencer types capital letters and spaces. Rename this."`;
  return `<div class="project-row${legal ? "" : " needs-name"}${picked ? " selected" : ""}" role="option" aria-selected="${picked ? "true" : "false"}" tabindex="0" data-project="${name}" data-place="${place}"${nameTitle}>
    <span class="session-name">${name}</span>
    <span class="bpm">${Math.round(item.info.bpm)}</span>
  </div>`;
}

function paintPlaces() {
  paintDriveSelect();
  paintDashActions();
}

function currentPick() {
  const pick = state.projectPick;
  if (!pick) return null;
  const library = pick.place === "card" ? state.cardLibrary : state.studioLibrary;
  const item = library?.projects?.find((entry) => entry.name === pick.name);
  return item ? pick : null;
}

function paintDashActions() {
  const pick = currentPick();
  const kept = Boolean(pick && keptProject(pick.name));
  const place = pick?.place || state.homePlace || "studio";
  const other = place === "studio" ? "card" : "studio";
  const canMove = Boolean(pick && !kept && placeRoot(other));
  $("pick-open").disabled = !pick;
  $("pick-duplicate").disabled = !pick;
  $("pick-rename").disabled = !pick || kept;
  $("pick-delete").disabled = !pick || kept;
  $("pick-rename").title = kept ? "FACTORY stays on the card" : "";
  $("pick-delete").title = kept ? "FACTORY stays on the card" : "";
  const move = $("pick-move");
  move.textContent = other === "studio" ? "To studio" : "To card";
  move.disabled = !canMove;
  move.title = kept ? "FACTORY stays on the card" : (pick && !placeRoot(other) ? "Connect the card" : "");
  document.querySelectorAll(".project-row[data-project]").forEach((row) => {
    const on = Boolean(pick && row.dataset.project === pick.name && row.dataset.place === pick.place);
    row.classList.toggle("selected", on);
    if (row.getAttribute("role") === "option") row.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function selectProject(place, name) {
  state.homePlace = place;
  state.projectPick = { place, name };
  paintDashActions();
  const row = document.querySelector(`.project-row.selected[data-place="${place}"]`);
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: "nearest" });
}

function listedProjects(place) {
  const library = place === "card" ? state.cardLibrary : state.studioLibrary;
  return library?.projects || [];
}

function paintNameField(input) {
  const start = input.selectionStart || 0;
  const cleaned = input.value.toUpperCase().replace(/[^A-Z ]/g, "").slice(0, 16);
  if (cleaned === input.value) return;
  input.value = cleaned;
  const pos = Math.min(start, cleaned.length);
  input.setSelectionRange(pos, pos);
}

async function openListedProject(place, name) {
  const root = placeRoot(place);
  const library = place === "card" ? state.cardLibrary : state.studioLibrary;
  if (!root || !library || !await confirmEdits()) return;
  state.root = root;
  state.library = library;
  await enterProject(name);
}

async function moveProject(place, name) {
  const other = place === "studio" ? "card" : "studio";
  const destination = placeRoot(other);
  if (!destination) {
    setStatus("Connect the card first.", "error");
    return;
  }
  const from = place === "studio" ? "studio" : "card";
  const accepted = await askConfirm({
    title: `Move ${name} to the ${other}?`,
    message: `It leaves the ${from}.`,
    confirm: "Move",
  });
  if (!accepted) return;
  await api("/api/project/transfer", projectBody({
    root: placeRoot(place),
    project: name,
    destination,
    mode: "move",
  }));
  state.projectPick = { place: other, name };
  state.homePlace = other;
  await reloadProjects(`Moved ${name} to the ${other}.`);
}

$("home").addEventListener("input", (event) => {
  const input = event.target;
  if (input.name === "name" || input.name === "next") paintNameField(input);
});

function beginRename() {
  const pick = currentPick();
  if (!pick || keptProject(pick.name)) return;
  state.projectAction = { mode: "rename", place: pick.place, project: pick.name, draft: readProjectName(pick.name) };
  renderProjectMenu();
}

function beginDuplicate() {
  const pick = currentPick();
  if (!pick) return;
  state.projectAction = { mode: "duplicate", place: pick.place, project: pick.name, draft: "" };
  renderProjectMenu();
}

function deletePicked() {
  const pick = currentPick();
  if (!pick || keptProject(pick.name)) return;
  const where = pick.place === "card" ? "card" : "studio";
  askConfirm({
    title: `Delete ${pick.name}?`,
    message: `This removes it from the ${where}, including its banks, patterns, and songs.`,
    confirm: "Delete project",
    danger: true,
  }).then((accepted) => {
    if (!accepted) return null;
    return api("/api/project/delete", projectBody({ root: placeRoot(pick.place), project: pick.name }));
  }).then((result) => {
    if (!result) return;
    state.projectPick = null;
    return reloadProjects(`Deleted ${pick.name}.`);
  }).catch((error) => setStatus(error.message, "error"));
}

$("home").addEventListener("click", (event) => {
  const row = event.target.closest(".project-row[data-project]");
  if (row && !event.target.closest("input, button")) {
    selectProject(row.dataset.place, row.dataset.project);
    return;
  }
  if (event.target.closest("#pick-open")) {
    const pick = currentPick();
    if (pick) openListedProject(pick.place, pick.name).catch((error) => setStatus(error.message, "error"));
    return;
  }
  if (event.target.closest("#pick-rename")) {
    beginRename();
    return;
  }
  if (event.target.closest("#pick-duplicate")) {
    beginDuplicate();
    return;
  }
  if (event.target.closest("#pick-move")) {
    const pick = currentPick();
    if (pick) moveProject(pick.place, pick.name).catch((error) => setStatus(error.message, "error"));
    return;
  }
  if (event.target.closest("#pick-delete")) {
    deletePicked();
    return;
  }
  const cancel = event.target.closest("[data-project-cancel]");
  if (cancel) {
    state.projectAction = null;
    renderProjectMenu();
  }
});

$("home").addEventListener("dblclick", (event) => {
  const row = event.target.closest(".project-row[data-project]");
  if (!row || event.target.closest("input, button")) return;
  openListedProject(row.dataset.place, row.dataset.project).catch((error) => setStatus(error.message, "error"));
});

$("home").addEventListener("keydown", (event) => {
  if (event.target.closest("input")) return;
  const place = currentPick()?.place || state.homePlace || "studio";
  const projects = listedProjects(place);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!projects.length) return;
    event.preventDefault();
    const index = projects.findIndex((item) => state.projectPick?.place === place && state.projectPick?.name === item.name);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = projects[index < 0 ? 0 : Math.max(0, Math.min(projects.length - 1, index + step))];
    selectProject(place, next.name);
    return;
  }
  if (event.key === "Enter" && currentPick() && !event.target.closest("button")) {
    event.preventDefault();
    const pick = currentPick();
    openListedProject(pick.place, pick.name).catch((error) => setStatus(error.message, "error"));
  }
});

$("home").addEventListener("submit", (event) => {
  const created = event.target.closest("[data-create-place]");
  if (created) {
    event.preventDefault();
    const input = created.querySelector("[name=name]");
    const next = readProjectName(input.value);
    const error = projectNameError(next, { mode: "create", project: "" });
    if (error) {
      setStatus(error, "error");
      return;
    }
    input.value = "";
    createNamedProject(next, created.dataset.createPlace).catch((error) => setStatus(error.message, "error"));
    return;
  }
  const form = event.target.closest("[data-project-form]");
  if (!form || !state.projectAction) return;
  event.preventDefault();
  const next = readProjectName(new FormData(form).get("next") || "");
  const action = state.projectAction;
  if (action.mode === "rename" && next === action.project) {
    state.projectAction = null;
    renderProjectMenu();
    return;
  }
  const error = projectNameError(next, action);
  if (error) {
    setStatus(error, "error");
    return;
  }
  const path = action.mode === "rename" ? "/api/project/rename" : "/api/project/duplicate";
  api(path, projectBody({ root: placeRoot(action.place), project: action.project, name: next }))
    .then((saved) => {
      state.projectPick = { place: action.place, name: saved.name };
      const detail = action.mode === "rename" ? `Renamed ${action.project} to ${saved.name}.` : `Duplicated ${action.project} as ${saved.name}.`;
      return reloadProjects(detail);
    })
    .catch((error) => setStatus(error.message, "error"));
});

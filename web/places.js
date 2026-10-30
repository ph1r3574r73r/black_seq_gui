const CARD_DRIVE = "blackseq.card";

function placeRoot(place) {
  if (!state.places) return "";
  if (place === "card") return state.places.card || "";
  return state.places.studio || "";
}

function rememberedDrive() {
  try {
    return localStorage.getItem(CARD_DRIVE);
  } catch (error) {
    return null;
  }
}

function rememberDrive(path) {
  try {
    if (path === null) localStorage.removeItem(CARD_DRIVE);
    else localStorage.setItem(CARD_DRIVE, path);
  } catch (error) {
    // The choice still applies until the page is closed.
  }
}

async function refreshPlaces() {
  const preferred = rememberedDrive();
  const query = preferred === null ? "" : `?card=${encodeURIComponent(preferred)}`;
  state.places = await api(`/api/places${query}`);
  if (preferred === null && state.places.card) rememberDrive(state.places.card);
  if (preferred && !state.places.card) rememberDrive(null);
  return state.places;
}

function paintDriveSelect() {
  const select = $("card-drive");
  if (!select || !state.places) return;
  const current = state.places.card || "";
  const drives = state.places.drives || [];
  select.innerHTML = [
    `<option value="">Choose a drive</option>`,
    ...drives.map((drive) => `<option value="${escapeHtml(drive.path)}">${escapeHtml(drive.name)}</option>`),
  ].join("");
  select.value = drives.some((drive) => drive.path === current) ? current : "";
}

async function bootPlaces() {
  try {
    state.schema = await api("/api/schema");
    await loadLibraries();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

$("card-drive").addEventListener("change", () => {
  rememberDrive($("card-drive").value);
  if (state.projectPick?.place === "card") state.projectPick = null;
  loadLibraries().catch((error) => setStatus(error.message, "error"));
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !$("workspace").hidden) return;
  loadLibraries().catch((error) => setStatus(error.message, "error"));
});

bootPlaces();

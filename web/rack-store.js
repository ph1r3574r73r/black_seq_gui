let songRackTimer = 0;
let songRackDirty = false;
let songRackTarget = null;

function clearSongRackEdit() {
  songRackDirty = false;
  clearTimeout(songRackTimer);
}

function noteSongRack() {
  if (!state.projectName || !state.bank || !state.songSlot) return;
  songRackDirty = true;
  songRackTarget = { project: state.projectName, bank: state.bank, slot: state.songSlot };
  clearTimeout(songRackTimer);
  songRackTimer = setTimeout(() => {
    flushSongRack().catch((error) => setStatus(error.message, "error"));
  }, 400);
}

async function flushSongRack() {
  clearTimeout(songRackTimer);
  if (!songRackDirty || !songRackTarget || !state.rack) return;
  const target = songRackTarget;
  const rack = rackSnapshot();
  songRackDirty = false;
  try {
    await api("/api/rack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...target, rack }),
    });
  } catch (error) {
    songRackDirty = true;
    songRackTarget = target;
    throw error;
  }
}

async function useSongRack() {
  clearSongRackEdit();
  if (!state.projectName) return;
  const query = `project=${encodeURIComponent(state.projectName)}&bank=${encodeURIComponent(state.bank)}&slot=${encodeURIComponent(state.songSlot)}`;
  const saved = await api(`/api/rack?${query}`);
  adoptRack(saved.rack || defaultRack());
}

async function storeRackPreset(name, rack) {
  await api("/api/preset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, rack }),
  });
}

async function removeRackPreset(name) {
  await api("/api/preset/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

async function loadRackPresets() {
  const saved = await api("/api/presets");
  rackPresetCache = saved.presets && typeof saved.presets === "object" ? saved.presets : {};
  let local = {};
  try {
    local = JSON.parse(localStorage.getItem("blackseq.rackPresets") || "{}");
  } catch (error) {
    local = {};
  }
  if (!local || typeof local !== "object" || Array.isArray(local)) local = {};
  for (const [name, rack] of Object.entries(local)) {
    if (rackPresetCache[name] || !rack) {
      delete local[name];
      continue;
    }
    try {
      await storeRackPreset(name, rack);
      rackPresetCache[name] = rack;
      delete local[name];
    } catch (error) {
      continue;
    }
  }
  if (Object.keys(local).length) localStorage.setItem("blackseq.rackPresets", JSON.stringify(local));
  else localStorage.removeItem("blackseq.rackPresets");
  renderRackPresets();
}

loadRackPresets().catch((error) => setStatus(error.message, "error"));

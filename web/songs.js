async function refreshSongs() {
  state.library = await api(`/api/library?root=${encodeURIComponent(state.root)}`);
  renderPads();
  renderSong();
}

function songPayload(extra) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      root: state.root,
      project: state.projectName,
      bank: state.bank,
      slot: state.songSlot,
      ...extra,
    }),
  };
}

async function renameSong() {
  const field = $("song-name");
  const name = field.value;
  try {
    const saved = await api("/api/song/name", songPayload({ name }));
    field.value = saved.name;
    await refreshSongs();
    const number = machineNumber(state.songSlot);
    setStatus(
      saved.name
        ? `Named song ${number} “${saved.name}”. The module still shows ${number}.`
        : `Cleared the name on song ${number}.`,
      "ok",
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function duplicateSong() {
  if (state.songDirty && !await confirmEdits("song")) return;
  if (typeof flushSongRack === "function") await flushSongRack();
  try {
    const saved = await api("/api/song/duplicate", songPayload({}));
    await refreshSongs();
    setStatus(`Duplicated song ${machineNumber(state.songSlot)} to ${machineNumber(saved.slot)}.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function moveSong() {
  const target = $("song-target").value;
  if (!target) return;
  if (state.songDirty && !await confirmEdits("song")) return;
  if (typeof flushSongRack === "function") await flushSongRack();
  if (state.playing && state.playMode === "song") stopPlayback();
  try {
    const saved = await api("/api/song/move", songPayload({ target }));
    state.songDirty = false;
    state.songSlot = saved.slot;
    state.library = await api(`/api/library?root=${encodeURIComponent(state.root)}`);
    await loadSong();
    renderPads();
    showTab("song");
    setStatus(`Moved the song to ${machineNumber(saved.slot)}.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function deleteSong() {
  const number = machineNumber(state.songSlot);
  const name = songLabel();
  const called = name ? `song ${number}, ${name}` : `song ${number}`;
  if (state.songDirty && !await confirmEdits("song")) return;
  const accepted = await askConfirm({
    title: `Delete ${called}?`,
    message: `This removes it from bank ${machineNumber(state.bank)} on the card.`,
    confirm: "Delete song",
    danger: true,
  });
  if (!accepted) return;
  if (typeof clearSongRackEdit === "function") clearSongRackEdit();
  if (state.playing && state.playMode === "song") stopPlayback();
  try {
    await api("/api/song/delete", songPayload({}));
    state.songDirty = false;
    state.library = await api(`/api/library?root=${encodeURIComponent(state.root)}`);
    await loadSong();
    renderPads();
    showTab("song");
    setStatus(`Deleted song ${number}.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

$("song-name").addEventListener("change", renameSong);
$("song-name").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("song-name").blur();
  }
});
$("duplicate-song").addEventListener("click", duplicateSong);
$("move-song").addEventListener("click", moveSong);
$("delete-song").addEventListener("click", deleteSong);

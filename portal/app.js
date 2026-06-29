const state = {
  token: sessionStorage.getItem("roonia.portal.token") || "",
  view: "dashboard",
  zones: [],
  playlists: [],
  selectedPlaylistId: null,
  keys: [],
  dashboard: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const fmtDate = (value) => value
  ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Nunca";

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || `Error HTTP ${response.status}`);
    error.code = body?.error?.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

function toast(message, type = "ok") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("#toast-region").append(node);
  setTimeout(() => node.remove(), 3600);
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.dataset.label ||= button.textContent;
  button.textContent = busy ? "Procesando…" : button.dataset.label;
}

function showApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
}

function showLogin(message = "") {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#login-error").textContent = message;
  $("#login-token").focus();
}

async function authenticate(token) {
  state.token = token.trim();
  const session = await api("/api/session");
  sessionStorage.setItem("roonia.portal.token", state.token);
  $("#version-badge").textContent = `v${session.version}`;
  showApp();
  await navigate("dashboard");
}

const viewCopy = {
  dashboard: ["Vista general", "El bridge, de un vistazo"],
  zones: ["Roon Core", "Reproducción"],
  playlists: ["Biblioteca local", "Playlists"],
  keys: ["Acceso seguro", "API keys"],
  settings: ["Configuración", "Sistema"]
};

async function navigate(view) {
  state.view = view;
  $$(".view").forEach((node) => node.classList.toggle("active", node.id === `view-${view}`));
  $$(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  $("#view-eyebrow").textContent = viewCopy[view][0];
  $("#view-title").textContent = viewCopy[view][1];

  try {
    if (view === "dashboard") await loadDashboard();
    if (view === "zones") await loadZones();
    if (view === "playlists") await loadPlaylists();
    if (view === "keys") await loadKeys();
    if (view === "settings") await loadSettings();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      sessionStorage.removeItem("roonia.portal.token");
      showLogin(error.message);
      return;
    }
    toast(error.message, "error");
  }
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  state.dashboard = data;
  const connected = data.status.core_connected;
  $("#connection-dot").classList.toggle("online", connected);
  $("#connection-label").textContent = connected
    ? `Conectado a ${data.status.core_name || "Roon Core"}`
    : "Roon Core desconectado";
  $("#status-hero").innerHTML = `
    <div>
      <p class="eyebrow">${connected ? "Sistema disponible" : "Atención requerida"}</p>
      <h3>${connected ? escapeHtml(data.status.core_name || "Roon Core") : "Esperando a Roon Core"}</h3>
      <p class="muted">${connected
        ? "Transporte y biblioteca están listos para recibir órdenes."
        : "El portal está activo, pero todavía no puede controlar el audio."}</p>
    </div>
    <div class="status-pill">${connected ? "● En línea" : "○ Desconectado"}</div>`;
  const metrics = [
    [data.counts.zones, "Zonas visibles"],
    [data.counts.playing_zones, "Reproduciendo"],
    [data.counts.playlists, "Playlists"],
    [data.counts.active_api_keys, "API keys activas"]
  ];
  $("#metric-grid").innerHTML = metrics.map(([value, label]) =>
    `<article class="metric"><strong>${value}</strong><span>${label}</span></article>`
  ).join("");
  $("#now-playing-grid").innerHTML = data.now_playing.length
    ? data.now_playing.map((item) => `
      <article class="now-card">
        <div class="album-art">♫</div>
        <h4>${escapeHtml(item.title || "Sin título")}</h4>
        <p>${escapeHtml(item.artist || "Artista desconocido")} · ${escapeHtml(item.display_name)}</p>
      </article>`).join("")
    : `<div class="empty-state">Ninguna zona está reproduciendo ahora mismo.</div>`;
}

function outputVolume(zone) {
  return zone.outputs?.find((output) => Number.isFinite(output.volume?.value))?.volume || null;
}

function zoneCard(zone) {
  const playing = zone.state === "playing";
  const volume = outputVolume(zone);
  const grouped = (zone.outputs?.length || 0) > 1;
  return `
    <article class="zone-card ${playing ? "playing" : ""}" data-zone="${escapeHtml(zone.zone_id)}">
      <div class="zone-head">
        <div class="zone-art">${playing ? "♪" : "♫"}</div>
        <div class="zone-meta">
          <span class="zone-state">${escapeHtml(zone.state)}</span>
          <h3>${escapeHtml(zone.display_name)}</h3>
          <p>${escapeHtml(zone.now_playing?.line1 || "Nada en reproducción")}${zone.now_playing?.line2 ? ` · ${escapeHtml(zone.now_playing.line2)}` : ""}</p>
        </div>
      </div>
      <div class="transport">
        <button data-command="previous" title="Anterior">│◀</button>
        <span></span>
        <button class="play" data-command="${playing ? "pause" : "play"}" title="${playing ? "Pausar" : "Reproducir"}">${playing ? "Ⅱ" : "▶"}</button>
        <span></span>
        <button data-command="next" title="Siguiente">▶│</button>
      </div>
      <div class="zone-tools">
        ${volume ? `<div class="volume-row"><span>Vol.</span><input data-volume type="range" min="${volume.min ?? 0}" max="${volume.max ?? 100}" value="${volume.value}"><output>${Math.round(volume.value)}</output></div>` : ""}
        <div class="quick-play">
          <input data-query placeholder="Busca música…">
          <select data-query-mode aria-label="Acción de búsqueda">
            <option value="play_now">Play</option>
            <option value="add_next">Siguiente</option>
            <option value="add_to_queue">A la cola</option>
          </select>
          <button class="button primary" data-play-query>Aplicar</button>
        </div>
        <div class="zone-links">
          <button class="text-button" data-queue>Ver cola</button>
          <button class="text-button" data-transfer>Transferir</button>
          ${grouped ? `<button class="text-button" data-ungroup>Desagrupar (${zone.outputs.length})</button>` : `<span class="muted">${zone.outputs?.length || 0} output</span>`}
        </div>
      </div>
      <div class="queue-panel" hidden></div>
    </article>`;
}

async function loadZones() {
  state.zones = await api("/api/roon/zones");
  $("#zones-grid").innerHTML = state.zones.length
    ? state.zones.map(zoneCard).join("")
    : `<div class="empty-state">No hay zonas disponibles. Comprueba la conexión con Roon Core.</div>`;
  fillZoneSelects();
}

async function controlZone(zoneId, command, button) {
  setBusy(button, true);
  try {
    await api(`/api/roon/zones/${encodeURIComponent(zoneId)}/control`, {
      method: "POST", body: JSON.stringify({ command })
    });
    toast(`Orden ${command} confirmada por Roon`);
    await loadZones();
  } finally { setBusy(button, false); }
}

async function changeVolume(zoneId, value, output) {
  await api(`/api/roon/zones/${encodeURIComponent(zoneId)}/volume`, {
    method: "POST", body: JSON.stringify({ mode: "absolute", value: Number(value) })
  });
  output.textContent = Math.round(Number(value));
  toast("Volumen actualizado");
}

async function playQuery(zoneId, query, mode, button) {
  if (!query.trim()) return;
  setBusy(button, true);
  try {
    if (mode === "play_now") {
      await api("/api/roon/play", {
        method: "POST", body: JSON.stringify({ zone_id: zoneId, query: query.trim() })
      });
    } else {
      await api(`/api/roon/queue/${encodeURIComponent(zoneId)}`, {
        method: "POST", body: JSON.stringify({ action: mode, query: query.trim() })
      });
    }
    toast(mode === "play_now" ? "Reproducción iniciada" : "Cola actualizada");
    await loadZones();
  } finally { setBusy(button, false); }
}

function transferDialog(sourceZoneId) {
  const source = state.zones.find((zone) => zone.zone_id === sourceZoneId);
  const targets = state.zones.filter((zone) => zone.zone_id !== sourceZoneId);
  openForm({
    eyebrow: "Cola nativa",
    title: `Transferir desde ${source?.display_name || "zona"}`,
    fields: `<label>Zona de destino<select name="target_zone_id" required>${targets.map((zone) => `<option value="${escapeHtml(zone.zone_id)}">${escapeHtml(zone.display_name)}</option>`).join("")}</select></label><p class="muted">Roon moverá la cola y el estado de reproducción sin reconstruirlos.</p>`,
    submitLabel: "Transferir reproducción",
    onSubmit: async (data) => {
      await api("/api/roon/zones/transfer", {
        method: "POST",
        body: JSON.stringify({ source_zone_id: sourceZoneId, target_zone_id: data.target_zone_id })
      });
      toast("Reproducción transferida y verificada");
      await loadZones();
    }
  });
}

async function toggleQueue(zoneId, panel) {
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = `<p class="muted">Cargando cola…</p>`;
  try {
    const data = await api(`/api/roon/queue/${encodeURIComponent(zoneId)}?max_item_count=50`);
    panel.innerHTML = data.items?.length
      ? data.items.map((item, index) => `<div class="queue-item"><span>${index + 1}</span><span><strong>${escapeHtml(item.title || "Sin título")}</strong><small>${escapeHtml(item.subtitle || "")}</small></span></div>`).join("")
      : `<p class="muted">La cola está vacía.</p>`;
  } catch (error) {
    panel.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  }
}

function fillZoneSelects() {
  const options = state.zones.map((zone) =>
    `<option value="${escapeHtml(zone.zone_id)}">${escapeHtml(zone.display_name)}</option>`
  ).join("");
  $("#group-primary").innerHTML = options;
  $("#group-options").innerHTML = state.zones.map((zone) =>
    `<label><input type="checkbox" value="${escapeHtml(zone.zone_id)}"> ${escapeHtml(zone.display_name)}</label>`
  ).join("");
  $$("[data-zone-select]").forEach((select) => { select.innerHTML = options; });
}

async function loadPlaylists() {
  const [playlists, zones] = await Promise.all([
    api("/api/playlists"),
    state.zones.length ? Promise.resolve(state.zones) : api("/api/roon/zones")
  ]);
  state.playlists = playlists;
  state.zones = zones;
  $("#playlist-list").innerHTML = playlists.length
    ? playlists.map((playlist) => `
      <button class="playlist-row ${playlist.playlist_id === state.selectedPlaylistId ? "active" : ""}" data-playlist="${escapeHtml(playlist.playlist_id)}">
        <span><strong>${escapeHtml(playlist.name)}</strong><small>${escapeHtml(playlist.description || "Sin descripción")}</small></span>
        <span class="count">${playlist.tracks_count} pistas</span>
      </button>`).join("")
    : `<div class="empty-state">Todavía no hay playlists.</div>`;
  if (state.selectedPlaylistId) renderPlaylistEditor();
}

function renderPlaylistEditor() {
  const playlist = state.playlists.find((item) => item.playlist_id === state.selectedPlaylistId);
  const editor = $("#playlist-editor");
  if (!playlist) {
    state.selectedPlaylistId = null;
    editor.className = "editor-panel empty-panel";
    editor.innerHTML = `<span class="empty-icon">♫</span><h3>Selecciona una playlist</h3><p class="muted">Edita pistas, orden y reproducción desde aquí.</p>`;
    return;
  }
  editor.className = "editor-panel";
  editor.innerHTML = `
    <div class="editor-title">
      <div><p class="eyebrow">${playlist.tracks_count} pistas</p><h3>${escapeHtml(playlist.name)}</h3><p class="muted">${escapeHtml(playlist.description || "Sin descripción")}</p></div>
      <div><button class="small-button" data-edit-playlist title="Editar">✎</button><button class="small-button" data-delete-playlist title="Eliminar">×</button></div>
    </div>
    <div class="track-list">
      ${playlist.tracks.length ? playlist.tracks.map((track, index) => `
        <div class="track-row" data-track="${escapeHtml(track.track_id)}">
          <span>${index + 1}</span>
          <span><strong>${escapeHtml(track.title || track.query)}</strong><small>${escapeHtml([track.artist, track.album].filter(Boolean).join(" · ") || track.query)}</small></span>
          <span class="track-actions">
            <button class="small-button" data-move="-1" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="small-button" data-move="1" ${index === playlist.tracks.length - 1 ? "disabled" : ""}>↓</button>
            <button class="small-button" data-delete-track>×</button>
          </span>
        </div>`).join("") : `<div class="empty-state">Añade la primera pista con una búsqueda estable.</div>`}
    </div>
    <button class="button ghost wide" data-add-track>+ Añadir pista</button>
    <div class="playbar">
      <select data-zone-select aria-label="Zona">${state.zones.map((zone) => `<option value="${escapeHtml(zone.zone_id)}">${escapeHtml(zone.display_name)}</option>`).join("")}</select>
      <select data-play-mode aria-label="Modo"><option value="play_now">Reproducir ahora</option><option value="add_next">Añadir siguiente</option><option value="add_to_queue">Añadir a cola</option></select>
      <button class="button primary" data-play-playlist>▶ Play</button>
    </div>`;
}

function openForm({ eyebrow, title, fields, submitLabel = "Guardar", onSubmit }) {
  $("#dialog-eyebrow").textContent = eyebrow;
  $("#dialog-title").textContent = title;
  $("#dialog-fields").innerHTML = fields;
  $("#dialog-submit").textContent = submitLabel;
  $("#dialog-error").textContent = "";
  $("#dialog-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#dialog-submit");
    setBusy(button, true);
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      await onSubmit(data);
      $("#form-dialog").close();
    } catch (error) {
      $("#dialog-error").textContent = error.message;
    } finally { setBusy(button, false); }
  };
  $("#form-dialog").showModal();
}

function newPlaylistDialog() {
  openForm({
    eyebrow: "Nueva colección",
    title: "Crear playlist",
    fields: `<label>Nombre<input name="name" required maxlength="80" autofocus></label><label>Descripción<textarea name="description" maxlength="240"></textarea></label>`,
    submitLabel: "Crear playlist",
    onSubmit: async (data) => {
      const created = await api("/api/playlists", { method: "POST", body: JSON.stringify(data) });
      state.selectedPlaylistId = created.playlist_id;
      toast("Playlist creada");
      await loadPlaylists();
    }
  });
}

function editPlaylistDialog(playlist) {
  openForm({
    eyebrow: "Metadatos",
    title: "Editar playlist",
    fields: `<label>Nombre<input name="name" required maxlength="80" value="${escapeHtml(playlist.name)}"></label><label>Descripción<textarea name="description" maxlength="240">${escapeHtml(playlist.description || "")}</textarea></label>`,
    onSubmit: async (data) => {
      await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}`, { method: "PATCH", body: JSON.stringify(data) });
      toast("Playlist actualizada");
      await loadPlaylists();
    }
  });
}

function addTrackDialog(playlist) {
  openForm({
    eyebrow: "Nueva pista",
    title: `Añadir a ${playlist.name}`,
    fields: `<label>Búsqueda estable<input name="query" required placeholder="artista canción"></label><label>Título (opcional)<input name="title"></label><label>Artista (opcional)<input name="artist"></label><label>Álbum (opcional)<input name="album"></label>`,
    submitLabel: "Añadir pista",
    onSubmit: async (data) => {
      await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/tracks`, { method: "POST", body: JSON.stringify(data) });
      toast("Pista añadida");
      await loadPlaylists();
    }
  });
}

async function reorderTrack(playlist, trackId, direction) {
  const ids = playlist.tracks.map((track) => track.track_id);
  const index = ids.indexOf(trackId);
  const target = index + direction;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/tracks/reorder`, {
    method: "POST", body: JSON.stringify({ track_ids: ids })
  });
  await loadPlaylists();
}

async function loadKeys() {
  state.keys = await api("/api/admin/api-keys");
  $("#keys-table").innerHTML = state.keys.length
    ? state.keys.map((key) => `
      <tr>
        <td><strong>${escapeHtml(key.name)}</strong></td>
        <td><code>${escapeHtml(key.key_prefix)}</code></td>
        <td><span class="role">${escapeHtml(key.role)}</span></td>
        <td>${escapeHtml(fmtDate(key.last_used_at))}</td>
        <td class="${key.revoked_at ? "status-revoked" : "status-active"}">${key.revoked_at ? "Revocada" : "Activa"}</td>
        <td>${key.revoked_at ? "" : `<button class="button danger" data-revoke-key="${escapeHtml(key.key_id)}">Revocar</button>`}</td>
      </tr>`).join("")
    : `<tr><td colspan="6"><div class="empty-state">No hay API keys gestionadas. El token de entorno no se lista aquí.</div></td></tr>`;
}

function newKeyDialog() {
  openForm({
    eyebrow: "Nueva credencial",
    title: "Crear API key",
    fields: `<label>Nombre<input name="name" required maxlength="80" placeholder="Integración del salón"></label><label>Permiso<select name="role"><option value="read">Solo lectura</option><option value="control" selected>Control de Roon</option><option value="admin">Administración completa</option></select></label>`,
    submitLabel: "Crear clave",
    onSubmit: async (data) => {
      const created = await api("/api/admin/api-keys", { method: "POST", body: JSON.stringify(data) });
      $("#new-secret").textContent = created.token;
      $("#secret-dialog").showModal();
      toast("API key creada");
      await loadKeys();
    }
  });
}

async function loadSettings() {
  const settings = await api("/api/admin/settings");
  const groups = [
    ["Servicio", [["Versión", settings.version], ["API HTTP", settings.api_port], ["Portal", settings.portal_port], ["Entorno", settings.node_environment]]],
    ["Capacidades", [["Browse", settings.browse_enabled], ["MCP", settings.mcp_enabled], ["Fuente", settings.streaming_source || "Sin definir"], ["URL pública", settings.public_base_url]]],
    ["Autenticación", [["API protegida", settings.api_auth_enabled], ["API token", settings.api_token_configured], ["Token del portal", settings.portal_admin_token_configured]]]
  ];
  $("#settings-grid").innerHTML = groups.map(([title, rows]) => `
    <article class="info-card"><p class="eyebrow">${title}</p><h3>${title}</h3>
    ${rows.map(([label, value]) => `<div class="setting-row"><span>${escapeHtml(label)}</span><strong>${typeof value === "boolean" ? (value ? "Sí" : "No") : escapeHtml(value)}</strong></div>`).join("")}</article>`
  ).join("");
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("button[type=submit]", event.currentTarget);
  setBusy(button, true);
  $("#login-error").textContent = "";
  try { await authenticate($("#login-token").value); }
  catch (error) { $("#login-error").textContent = error.message; }
  finally { setBusy(button, false); }
});

$("#main-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) navigate(button.dataset.view);
});
$("[data-go=zones]").addEventListener("click", () => navigate("zones"));
$("#refresh").addEventListener("click", () => navigate(state.view));
$("#logout").addEventListener("click", () => {
  sessionStorage.removeItem("roonia.portal.token");
  state.token = "";
  showLogin();
});
$$("[data-toggle-secret]").forEach((button) => button.addEventListener("click", () => {
  const input = document.getElementById(button.dataset.toggleSecret);
  input.type = input.type === "password" ? "text" : "password";
}));
$$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => {
  document.getElementById(button.dataset.closeDialog).close();
}));

$("#zones-grid").addEventListener("click", async (event) => {
  const card = event.target.closest("[data-zone]");
  if (!card) return;
  const zoneId = card.dataset.zone;
  try {
    const command = event.target.closest("[data-command]");
    if (command) await controlZone(zoneId, command.dataset.command, command);
    const play = event.target.closest("[data-play-query]");
    if (play) await playQuery(zoneId, $("[data-query]", card).value, $("[data-query-mode]", card).value, play);
    if (event.target.closest("[data-queue]")) await toggleQueue(zoneId, $(".queue-panel", card));
    if (event.target.closest("[data-transfer]")) transferDialog(zoneId);
    if (event.target.closest("[data-ungroup]")) {
      if (!confirm("¿Separar todos los outputs de este grupo?")) return;
      await api(`/api/roon/zones/${encodeURIComponent(zoneId)}/ungroup`, { method: "POST", body: "{}" });
      toast("Zonas separadas y verificadas");
      await loadZones();
    }
  } catch (error) { toast(error.message, "error"); }
});
$("#zones-grid").addEventListener("change", async (event) => {
  if (!event.target.matches("[data-volume]")) return;
  const card = event.target.closest("[data-zone]");
  try { await changeVolume(card.dataset.zone, event.target.value, event.target.nextElementSibling); }
  catch (error) { toast(error.message, "error"); await loadZones(); }
});

$("#open-group-dialog").addEventListener("click", async () => {
  if (!state.zones.length) await loadZones();
  fillZoneSelects();
  $("#group-error").textContent = "";
  $("#group-dialog").showModal();
});
$("#group-submit").addEventListener("click", async () => {
  const primary = $("#group-primary").value;
  const additional = $$("#group-options input:checked").map((input) => input.value).filter((id) => id !== primary);
  if (!additional.length) { $("#group-error").textContent = "Selecciona al menos una zona adicional."; return; }
  setBusy($("#group-submit"), true);
  try {
    await api("/api/roon/zones/group", { method: "POST", body: JSON.stringify({ primary_zone_id: primary, additional_zone_ids: additional }) });
    $("#group-dialog").close();
    toast("Grupo creado y verificado");
    await loadZones();
  } catch (error) { $("#group-error").textContent = error.message; }
  finally { setBusy($("#group-submit"), false); }
});

$("#new-playlist").addEventListener("click", newPlaylistDialog);
$("#playlist-list").addEventListener("click", (event) => {
  const row = event.target.closest("[data-playlist]");
  if (!row) return;
  state.selectedPlaylistId = row.dataset.playlist;
  $$(".playlist-row").forEach((node) => node.classList.toggle("active", node === row));
  renderPlaylistEditor();
});
$("#playlist-editor").addEventListener("click", async (event) => {
  const playlist = state.playlists.find((item) => item.playlist_id === state.selectedPlaylistId);
  if (!playlist) return;
  try {
    if (event.target.closest("[data-edit-playlist]")) editPlaylistDialog(playlist);
    if (event.target.closest("[data-add-track]")) addTrackDialog(playlist);
    if (event.target.closest("[data-delete-playlist]")) {
      if (!confirm(`¿Eliminar “${playlist.name}” y todas sus pistas?`)) return;
      await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}`, { method: "DELETE" });
      state.selectedPlaylistId = null;
      toast("Playlist eliminada");
      await loadPlaylists();
    }
    const trackRow = event.target.closest("[data-track]");
    const move = event.target.closest("[data-move]");
    if (trackRow && move) await reorderTrack(playlist, trackRow.dataset.track, Number(move.dataset.move));
    if (trackRow && event.target.closest("[data-delete-track]")) {
      await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/tracks/${encodeURIComponent(trackRow.dataset.track)}`, { method: "DELETE" });
      toast("Pista eliminada");
      await loadPlaylists();
    }
    const play = event.target.closest("[data-play-playlist]");
    if (play) {
      setBusy(play, true);
      try {
        await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/play`, {
          method: "POST",
          body: JSON.stringify({
            zone_id: $("[data-zone-select]", $("#playlist-editor")).value,
            mode: $("[data-play-mode]", $("#playlist-editor")).value
          })
        });
        toast("Playlist enviada a Roon");
      } finally { setBusy(play, false); }
    }
  } catch (error) { toast(error.message, "error"); }
});

$("#new-key").addEventListener("click", newKeyDialog);
$("#keys-table").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-revoke-key]");
  if (!button || !confirm("¿Revocar esta API key? La acción no se puede deshacer.")) return;
  try {
    await api(`/api/admin/api-keys/${encodeURIComponent(button.dataset.revokeKey)}`, { method: "DELETE" });
    toast("API key revocada");
    await loadKeys();
  } catch (error) { toast(error.message, "error"); }
});
$("#copy-secret").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#new-secret").textContent);
  toast("Clave copiada al portapapeles");
});

(async () => {
  if (!state.token) { showLogin(); return; }
  try { await authenticate(state.token); }
  catch { sessionStorage.removeItem("roonia.portal.token"); showLogin("La sesión anterior ya no es válida."); }
})();

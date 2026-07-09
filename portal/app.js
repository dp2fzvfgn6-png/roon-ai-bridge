const state = {
  token: sessionStorage.getItem("roonia.portal.token") || "",
  view: "dashboard",
  zones: [],
  playlists: [],
  selectedPlaylistId: null,
  keys: [],
  dashboard: null,
  browse: {
    hierarchy: "browse",
    sessionKey: `portal-${Date.now().toString(36)}`,
    current: null,
    pendingItem: null
  },
  system: null
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
  const { auth = true, ...fetchOptions } = options;
  const response = await fetch(path, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...(auth && state.token ? { Authorization: `Bearer ${state.token}` } : {}),
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
  const visible = $("#setup-form").hidden ? $("#login-username") : $("#setup-bootstrap");
  visible.focus();
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
  library: ["Roon Browse", "Explorar"],
  widgets: ["ChatGPT Apps", "Widgets"],
  playlists: ["Biblioteca local", "Playlists"],
  presets: ["Configuración de audio", "Presets y volúmenes"],
  operation: ["Administración", "Operación y diagnóstico"],
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
    if (view === "library") await loadBrowse(true);
    if (view === "widgets") await loadWidgets();
    if (view === "playlists") await loadPlaylists();
    if (view === "presets") await loadPresets();
    if (view === "operation") await loadOperation();
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

async function loadOperation() {
  const [health, ready, version, manifest, extensions, actions, errors, logs, diagnostics] = await Promise.all([
    api("/api/health"),
    api("/api/ready").catch((error) => ({ ok: false, ready: false, error: error.message })),
    api("/api/version"),
    api("/api/tools/manifest"),
    api("/api/extensions"),
    api("/api/observability/actions?limit=8"),
    api("/api/observability/errors?limit=8"),
    api("/api/logs/recent?limit=8"),
    api("/api/diagnostics/bundle")
  ]);
  const statusRows = [
    ["Health", health.status || (health.ok ? "healthy" : "error")],
    ["Ready", ready.ready ? "Sí" : "No"],
    ["Versión", version.app_version],
    ["Commit", version.commit],
    ["Tools MCP", manifest.tools_count]
  ];
  $("#operation-health").innerHTML = statusRows.map(([label, value]) =>
    `<div class="setting-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  ).join("");
  const manager = diagnostics.extension_manager || {};
  $("#extension-status").innerHTML = `<span>${escapeHtml(manager.manager_type || "unknown")}</span><strong>${manager.capabilities?.restart ? "Mutaciones disponibles" : "Solo lectura"}</strong>`;
  $("#extension-list").innerHTML = (extensions.extensions || []).map((extension) => `
    <article class="playlist-item">
      <div><strong>${escapeHtml(extension.name)}</strong><p class="muted">${escapeHtml([extension.status, extension.version, extension.deployment].filter(Boolean).join(" · "))}</p></div>
      <button class="small-button" data-extension-logs="${escapeHtml(extension.extension_id)}">Logs</button>
    </article>
  `).join("") || `<div class="empty-state">No hay extensiones detectadas.</div>`;
  renderActions(actions.actions || []);
  renderTechnicalLogs([...(errors.errors || []), ...(logs.logs || [])].slice(0, 10));
  $("#diagnostics-preview").textContent = JSON.stringify(diagnostics, null, 2);
}

function renderActions(actions) {
  $("#action-log-list").innerHTML = actions.length ? actions.map((action) => `
    <article class="log-row">
      <strong>${escapeHtml(action.tool_or_endpoint)}</strong>
      <span>${escapeHtml(action.source)} · ${escapeHtml(action.duration_ms)} ms · ${escapeHtml(action.error_code || "ok")}</span>
      <code>${escapeHtml(action.action_id)}</code>
    </article>
  `).join("") : `<div class="empty-state">Todavía no hay acciones registradas.</div>`;
}

function renderTechnicalLogs(logs) {
  $("#technical-log-list").innerHTML = logs.length ? logs.map((log) => `
    <article class="log-row ${escapeHtml(log.level)}">
      <strong>${escapeHtml(log.level)} · ${escapeHtml(log.component)}</strong>
      <span>${escapeHtml(log.message)}</span>
      <code>${escapeHtml(fmtDate(log.timestamp))}</code>
    </article>
  `).join("") : `<div class="empty-state">No hay errores recientes.</div>`;
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

async function loadWidgets() {
  const [nowPlaying, playlists] = await Promise.all([
    api("/api/widgets/now-playing"),
    api("/api/widgets/playlists")
  ]);
  renderWidgetNowPlaying(nowPlaying);
  renderWidgetPlaylists(playlists);
  const select = $("#widget-zone");
  select.innerHTML = (nowPlaying.zones || []).map((zone) =>
    `<option value="${escapeHtml(zone.zone_id)}">${escapeHtml(zone.display_name)}</option>`
  ).join("");
  if (nowPlaying.selected_zone_id) select.value = nowPlaying.selected_zone_id;
}

function widgetSelectedZone() {
  return $("#widget-zone")?.value || state.zones[0]?.zone_id || "";
}

function renderWidgetNowPlaying(payload) {
  $("#widget-now-playing").innerHTML = (payload.zones || []).map((zone) => `
    <article class="now-card" data-zone="${escapeHtml(zone.zone_id)}">
      <div class="album-art">${zone.now_playing?.image_url ? `<img alt="" src="${escapeHtml(zone.now_playing.image_url)}">` : "♫"}</div>
      <h4>${escapeHtml(zone.display_name)}</h4>
      <p>${escapeHtml([zone.state, zone.now_playing?.title, zone.now_playing?.artist].filter(Boolean).join(" · ") || "Sin reproducción")}</p>
      <p class="muted">${zone.volume?.value === null ? "Volumen no disponible" : `Vol. ${escapeHtml(zone.volume?.value)}${zone.volume?.safe_limit ? ` · límite ${escapeHtml(zone.volume.safe_limit)}` : ""}`}</p>
      <div class="top-actions">
        <button class="small-button" data-widget-now="previous">Anterior</button>
        <button class="small-button" data-widget-now="play_pause">Play/Pausa</button>
        <button class="small-button" data-widget-now="next">Siguiente</button>
        <button class="small-button" data-widget-now="volume_down">Vol -</button>
        <button class="small-button" data-widget-now="volume_up">Vol +</button>
      </div>
    </article>
  `).join("") || `<div class="empty-state">No hay zonas disponibles.</div>`;
}

function renderWidgetPlaylists(payload) {
  $("#widget-playlists").innerHTML = (payload.playlists || []).map((playlist) => `
    <article class="playlist-item" data-playlist="${escapeHtml(playlist.playlist_id)}">
      <div>
        <strong>${escapeHtml(playlist.name)}</strong>
        <p class="muted">${escapeHtml(playlist.track_count)} pistas${playlist.description ? ` · ${escapeHtml(playlist.description)}` : ""}</p>
      </div>
      <button class="button ghost" data-widget-open-playlist="${escapeHtml(playlist.playlist_id)}">Abrir</button>
    </article>
  `).join("") || `<div class="empty-state">No hay playlists virtuales.</div>`;
}

function renderWidgetPlaylistDetail(payload) {
  $("#widget-playlist-detail").classList.remove("empty-panel");
  $("#widget-playlist-detail").innerHTML = `
    <div class="section-toolbar">
      <div><p class="eyebrow">Playlist</p><h3>${escapeHtml(payload.playlist.name)}</h3></div>
      <div class="top-actions">
        <button class="button ghost" data-widget-playlist-action="add_playlist_to_queue">A cola</button>
        <button class="button primary" data-widget-playlist-action="play_playlist">Reproducir</button>
      </div>
    </div>
    <div class="playlist-track-list">
      ${(payload.tracks || []).map((track) => `
        <article class="track-row" data-track="${escapeHtml(track.track_id)}">
          <span>${escapeHtml(track.position)}</span>
          <div>
            <strong>${escapeHtml(track.title || track.track_id)}</strong>
            <p class="muted">${escapeHtml([track.artist, track.album, track.resolution_status].filter(Boolean).join(" · "))}</p>
          </div>
          <button class="small-button" data-widget-track="add_track_to_queue">Cola</button>
          <button class="small-button" data-widget-track="play_track">Play</button>
        </article>
      `).join("")}
    </div>`;
  $("#widget-playlist-detail").dataset.playlist = payload.playlist.playlist_id;
}

function renderWidgetSearch(payload) {
  $("#widget-search-results").innerHTML = (payload.results || []).map((result) => `
    <article class="playlist-item" data-result="${escapeHtml(result.result_id)}">
      <div>
        <strong>${escapeHtml(result.title)}</strong>
        <p class="muted">${escapeHtml([result.type, result.artist, result.album, result.source, result.confidence].filter(Boolean).join(" · "))}</p>
      </div>
      <div class="top-actions">
        <button class="small-button" data-widget-search="open_entity">Abrir</button>
        <button class="small-button" data-widget-search="add_to_queue">Cola</button>
        <button class="small-button" data-widget-search="play">Play</button>
      </div>
    </article>
  `).join("") || `<div class="empty-state">Sin resultados.</div>`;
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
        <div class="zone-art ${zone.now_playing?.image_key ? "cover" : ""}">${zone.now_playing?.image_key ? `<img alt="" data-image-key="${escapeHtml(zone.now_playing.image_key)}">` : (playing ? "♪" : "♫")}</div>
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
      <details class="advanced-controls">
        <summary>Controles avanzados</summary>
        <div class="advanced-grid">
          <button class="button ghost" data-restart-queue>Reiniciar cola</button>
          <button class="button ghost" data-toggle-shuffle>Shuffle</button>
          <button class="button ghost" data-toggle-radio>Auto radio</button>
          <button class="button ghost" data-cycle-loop>Loop</button>
          <div class="wide-row"><input data-seek-seconds type="number" step="1" placeholder="Segundos"><button class="button ghost" data-seek="absolute">Ir a</button><button class="button ghost" data-seek="relative">Mover</button></div>
          ${(zone.outputs || []).map((output) => `<div class="wide-row"><span class="muted">${escapeHtml(output.display_name)}</span><button class="small-button" data-output-step="${escapeHtml(output.output_id)}" data-step="-1">−</button><button class="small-button" data-output-step="${escapeHtml(output.output_id)}" data-step="1">+</button><button class="small-button" data-output-mute="${escapeHtml(output.output_id)}">Mute</button><button class="small-button" data-output-standby="${escapeHtml(output.output_id)}">Standby</button><button class="small-button" data-output-power="${escapeHtml(output.output_id)}">Alternar</button><button class="small-button" data-output-switch="${escapeHtml(output.output_id)}">Activar</button></div>`).join("")}
        </div>
      </details>
      <div class="queue-panel" hidden></div>
    </article>`;
}

async function loadZones() {
  state.zones = await api("/api/roon/zones");
  $("#zones-grid").innerHTML = state.zones.length
    ? state.zones.map(zoneCard).join("")
    : `<div class="empty-state">No hay zonas disponibles. Comprueba la conexión con Roon Core.</div>`;
  fillZoneSelects();
  await hydrateImages($("#zones-grid"));
}

async function hydrateImages(root) {
  const images = $$("img[data-image-key]", root);
  await Promise.all(images.map(async (image) => {
    try {
      const response = await fetch(
        `/api/roon/images/${encodeURIComponent(image.dataset.imageKey)}?width=160&height=160&scale=fill`,
        { headers: { Authorization: `Bearer ${state.token}` } }
      );
      if (!response.ok) return;
      image.src = URL.createObjectURL(await response.blob());
    } catch {}
  }));
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

async function loadBrowse(reset = false, popLevels = 0) {
  const browseState = state.browse;
  const params = new URLSearchParams({
    hierarchy: browseState.hierarchy,
    session_key: browseState.sessionKey,
    count: "100"
  });
  if (reset) params.set("pop_all", "true");
  if (popLevels) params.set("pop_levels", String(popLevels));
  const result = await api(`/api/roon/library?${params}`);
  renderBrowse(result);
}

function renderBrowse(result) {
  state.browse.current = result;
  $("#browse-heading").innerHTML = `<div><p class="eyebrow">${escapeHtml(result.hierarchy)}</p><h3>${escapeHtml(result.list?.title || "Roon Browse")}</h3><p class="muted">${escapeHtml(result.list?.subtitle || `${result.items?.length || 0} elementos`)}</p></div>`;
  $("#browse-list").innerHTML = result.items?.length
    ? result.items.map((item) => `
      <button class="browse-row" data-browse-item="${escapeHtml(item.item_key || "")}">
        <span class="browse-art">${item.image_key ? `<img alt="" data-image-key="${escapeHtml(item.image_key)}">` : "♫"}</span>
        <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subtitle || item.input_prompt?.prompt || "")}</small></span>
        <span class="badge">${escapeHtml(item.input_prompt ? "Entrada" : (item.hint || "abrir"))}</span>
      </button>`).join("")
    : `<div class="empty-state">${escapeHtml(result.message || "Esta lista no contiene elementos.")}</div>`;
  hydrateImages($("#browse-list"));
}

async function executeBrowseItem(item, input) {
  const result = await api("/api/roon/browse/action", {
    method: "POST",
    body: JSON.stringify({
      hierarchy: state.browse.hierarchy,
      item_key: item.item_key,
      session_key: state.browse.sessionKey,
      zone_id: state.zones[0]?.zone_id,
      ...(input !== undefined ? { input } : {})
    })
  });
  if (result.action === "list") {
    renderBrowse(result);
  } else if (result.action === "replace_item" && result.item) {
    const current = state.browse.current;
    current.items = current.items.map((candidate) =>
      candidate.item_key === item.item_key ? result.item : candidate
    );
    renderBrowse(current);
  } else if (result.action === "remove_item") {
    const current = state.browse.current;
    current.items = current.items.filter(
      (candidate) => candidate.item_key !== item.item_key
    );
    renderBrowse(current);
  } else {
    toast(result.message || `Acción ${result.action} completada`, result.is_error ? "error" : "ok");
  }
}

$("#browse-list").addEventListener("click", async (event) => {
  const row = event.target.closest("[data-browse-item]");
  if (!row) return;
  const item = state.browse.current?.items?.find(
    (candidate) => candidate.item_key === row.dataset.browseItem
  );
  if (!item) return;
  if (item.input_prompt) {
    state.browse.pendingItem = item;
    $("#prompt-title").textContent = item.input_prompt.action || "Entrada requerida";
    $("#prompt-label").firstChild.textContent = item.input_prompt.prompt || "Valor";
    $("#prompt-input").type = item.input_prompt.is_password ? "password" : "text";
    $("#prompt-input").value = item.input_prompt.value || "";
    $("#prompt-error").textContent = "";
    $("#prompt-dialog").showModal();
    return;
  }
  try { await executeBrowseItem(item); }
  catch (error) { toast(error.message, "error"); }
});
$("#prompt-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await executeBrowseItem(state.browse.pendingItem, $("#prompt-input").value);
    $("#prompt-dialog").close();
  } catch (error) { $("#prompt-error").textContent = error.message; }
});
$("#browse-home").addEventListener("click", () => loadBrowse(true).catch((error) => toast(error.message, "error")));
$("#browse-back").addEventListener("click", () => loadBrowse(false, 1).catch((error) => toast(error.message, "error")));
$("#browse-hierarchy").addEventListener("change", async (event) => {
  state.browse.hierarchy = event.target.value;
  state.browse.sessionKey = `portal-${event.target.value}-${Date.now().toString(36)}`;
  try { await loadBrowse(true); } catch (error) { toast(error.message, "error"); }
});

async function loadPlaylists() {
  const [playlistPayload, zones] = await Promise.all([
    api("/api/playlists?include_tracks=true&track_limit=100"),
    state.zones.length ? Promise.resolve(state.zones) : api("/api/roon/zones")
  ]);
  const playlists = Array.isArray(playlistPayload) ? playlistPayload : (playlistPayload.playlists || []);
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
  const titleActions = $(".editor-title > div:last-child", editor);
  if (titleActions && !titleActions.querySelector("[data-validate-playlist]")) {
    titleActions.insertAdjacentHTML("afterbegin", `<button class="small-button" data-validate-playlist title="Validar">?</button><button class="small-button" data-dedupe-playlist title="Duplicados">D</button><button class="small-button" data-export-playlist title="Exportar CSV">CSV</button>`);
  }
  const addButton = $("[data-add-track]", editor);
  if (addButton && !editor.querySelector("[data-search-add-track]")) {
    addButton.insertAdjacentHTML("afterend", `<button class="button ghost wide" data-search-add-track>Buscar y elegir candidato</button>`);
  }
  $$(".track-row", editor).forEach((row) => {
    const actions = $(".track-actions", row);
    if (actions && !actions.querySelector("[data-edit-user-metadata]")) {
      actions.insertAdjacentHTML("afterbegin", `<button class="small-button" data-edit-user-metadata title="Metadata">M</button><button class="small-button" data-match-track title="Seleccionar candidato">S</button>`);
    }
  });
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

function showPlaylistPanel(html) {
  const panel = $("#playlist-issues") || (() => {
    const node = document.createElement("div");
    node.id = "playlist-issues";
    node.className = "queue-panel";
    $("#playlist-editor .editor-title")?.after(node);
    return node;
  })();
  panel.hidden = false;
  panel.innerHTML = html;
}

async function validateSelectedPlaylist(playlist) {
  const result = await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/validate`);
  showPlaylistPanel(`
    <p class="eyebrow">Validacion</p>
    <div class="setting-row"><span>Resolved</span><strong>${escapeHtml(result.summary.resolved)}</strong></div>
    <div class="setting-row"><span>Unresolved</span><strong>${escapeHtml(result.summary.unresolved)}</strong></div>
    <div class="setting-row"><span>Ambiguous</span><strong>${escapeHtml(result.summary.ambiguous)}</strong></div>
    ${result.issues?.slice(0, 12).map((issue) => `<div class="queue-item"><span>${escapeHtml(issue.severity)}</span><span><strong>${escapeHtml(issue.type)}</strong><small>${escapeHtml(issue.message)}</small></span></div>`).join("") || `<p class="muted">Sin incidencias.</p>`}`);
}

async function dedupeSelectedPlaylist(playlist) {
  const result = await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/deduplicate`, {
    method: "POST",
    body: JSON.stringify({ dry_run: true })
  });
  showPlaylistPanel(result.groups?.length
    ? result.groups.map((group) => `<div class="queue-item"><span>${escapeHtml(group.tracks.length)}</span><span><strong>${escapeHtml(group.match_key)}</strong><small>Conservar: ${escapeHtml(group.suggested_keep_track_id)}</small></span></div>`).join("")
    : `<p class="muted">No se detectaron duplicados probables.</p>`);
}

async function exportSelectedPlaylist(playlist) {
  const response = await fetch(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/export?format=csv`, {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
  const csv = await response.text();
  showPlaylistPanel(`<p class="eyebrow">CSV</p><textarea readonly rows="8">${escapeHtml(csv)}</textarea>`);
}

function editUserMetadataDialog(playlist, track) {
  openForm({
    eyebrow: "Metadata libre",
    title: track.title || track.query,
    fields: `<label>JSON<textarea name="json" rows="8">${escapeHtml(JSON.stringify(track.user_metadata || {}, null, 2))}</textarea></label>`,
    submitLabel: "Guardar metadata",
    onSubmit: async (data) => {
      await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/tracks/${encodeURIComponent(track.track_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ ...track, user_metadata: JSON.parse(data.json || "{}") })
      });
      toast("Metadata guardada");
      await loadPlaylists();
    }
  });
}

function searchCandidateDialog(playlist, track = null) {
  openForm({
    eyebrow: "Busqueda avanzada",
    title: track ? `Seleccionar para ${track.title || track.query}` : `Anadir a ${playlist.name}`,
    fields: `<label>Query<input name="query" required value="${escapeHtml(track?.query || "")}"></label><label>User metadata JSON<textarea name="user_metadata" rows="4">{}</textarea></label><div id="candidate-results" class="playlist-list"></div>`,
    submitLabel: "Buscar",
    onSubmit: async (data) => {
      const search = await api("/api/roon/media/search", {
        method: "POST",
        body: JSON.stringify({ query: data.query, types: ["track"], count: 10 })
      });
      const results = search.results || [];
      $("#candidate-results").innerHTML = results.length
        ? results.map((result) => `<button type="button" class="playlist-row" data-result="${escapeHtml(result.result_id)}"><span><strong>${escapeHtml(result.title)}</strong><small>${escapeHtml([result.artist, result.album, result.version_hint, result.source].filter(Boolean).join(" / "))}</small></span><span class="count">${escapeHtml(result.match_score)} ${escapeHtml(result.confidence)}</span></button>`).join("")
        : `<div class="empty-state">Sin candidatos. Prueba una busqueda mas amplia.</div>`;
      $("#candidate-results").onclick = async (event) => {
        const row = event.target.closest("[data-result]");
        if (!row) return;
        const userMetadata = JSON.parse(data.user_metadata || "{}");
        if (track) {
          await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/tracks/${encodeURIComponent(track.track_id)}/match`, {
            method: "POST",
            body: JSON.stringify({ result_id: row.dataset.result, selection_reason: "portal_manual_selection" })
          });
        } else {
          await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}/tracks/from-search-result`, {
            method: "POST",
            body: JSON.stringify({ result_id: row.dataset.result, user_metadata: userMetadata })
          });
        }
        $("#form-dialog").close();
        toast("Candidato aplicado");
        await loadPlaylists();
      };
      throw new Error("Elige un candidato de la lista para aplicar.");
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

async function loadPresets() {
  const [presets, limits, outputs, zones] = await Promise.all([
    api("/api/zone-presets"),
    api("/api/volume-limits"),
    api("/api/roon/outputs"),
    state.zones.length ? Promise.resolve(state.zones) : api("/api/roon/zones")
  ]);
  state.presets = presets;
  state.volumeLimits = limits;
  state.outputs = outputs;
  state.zones = zones;
  $("#preset-list").innerHTML = presets.length
    ? presets.map((preset) => {
      const volumeText = preset.volumes?.map((item) => `${item.target_ref.value}: ${item.volume}`).join(" · ") || "Sin volúmenes";
      return `
      <div class="preset-card" data-preset="${escapeHtml(preset.preset_id)}">
        <span><strong>${escapeHtml(preset.virtual_zone?.display_name || preset.name)}</strong><small>${escapeHtml(preset.description || volumeText)}</small></span>
        <span class="track-actions"><button class="small-button" data-preview-preset>Preview</button><button class="button primary" data-apply-preset>Aplicar</button><button class="small-button" data-edit-preset>Editar</button><button class="small-button" data-delete-preset>×</button></span>
      </div>`;
    }).join("")
    : `<div class="empty-state">No hay presets. Crea uno con una o mÃ¡s zonas u outputs.</div>`;
  $("#output-volume-list").innerHTML = `
    <div class="section-toolbar"><div><p class="muted">LÃ­mites generales y con horario. Se aplican a cambios de volumen y presets.</p></div><button class="button primary" data-new-volume-limit>+ Nuevo lÃ­mite</button></div>
    ${limits.length ? limits.map((limit) => `
      <div class="volume-settings-row" data-volume-limit="${escapeHtml(limit.limit_id)}">
        <strong>${escapeHtml(limit.name)}</strong>
        <span class="muted">${escapeHtml(limit.target_ref.type)} · ${escapeHtml(limit.target_ref.value)} · max ${escapeHtml(limit.safe_max)}</span>
        <span class="muted">${limit.schedule ? `${escapeHtml(limit.schedule.days.join(","))} ${escapeHtml(limit.schedule.from)}-${escapeHtml(limit.schedule.to)}` : "General"}</span>
        <span><button class="small-button" data-test-volume-limit>Probar</button><button class="small-button" data-edit-volume-limit>Editar</button><button class="small-button" data-delete-volume-limit>×</button></span>
      </div>`).join("") : `<div class="empty-state">TodavÃ­a no hay lÃ­mites configurados.</div>`}`;
}

function targetOptions(includeGlobal = false) {
  const outputOptions = (state.outputs || []).map((output) =>
    `<option value="output_id:${escapeHtml(output.output_id)}">Output · ${escapeHtml(output.display_name)}</option>`
  );
  const zoneOptions = (state.zones || []).map((zone) =>
    `<option value="zone_id:${escapeHtml(zone.zone_id)}">Zona · ${escapeHtml(zone.display_name)}</option>`
  );
  return [
    ...(includeGlobal ? [`<option value="global:global">Global</option>`] : []),
    ...outputOptions,
    ...zoneOptions
  ].join("");
}

function splitTarget(value) {
  const [type, ...rest] = String(value || "").split(":");
  return { type, value: rest.join(":") };
}

function presetDialog(preset = null) {
  const editing = Boolean(preset);
  const members = new Set((preset?.grouping?.members || []).map((item) => `${item.type}:${item.value}`));
  const primaryValue = preset?.grouping?.primary_zone_ref
    ? `${preset.grouping.primary_zone_ref.type}:${preset.grouping.primary_zone_ref.value}`
    : "";
  const volumeRows = (preset?.volumes?.length ? preset.volumes : [{ target_ref: null, volume: "" }])
    .map((item) => `<div class="wide-row preset-volume-row">
      <select name="volume_target">${targetOptions(false)}</select>
      <input name="volume_value" type="number" min="0" step="1" value="${escapeHtml(item.volume ?? "")}" placeholder="Volumen">
    </div>`)
    .join("");
  openForm({
    eyebrow: "Zona virtual",
    title: editing ? "Editar preset" : "Crear preset de zonas",
    fields: `<label>Nombre<input name="name" required maxlength="80" value="${escapeHtml(preset?.name || "")}"></label>
      <label>DescripciÃ³n<textarea name="description" maxlength="240">${escapeHtml(preset?.description || "")}</textarea></label>
      <label><span><input type="checkbox" name="grouping_enabled" value="yes" ${preset?.grouping?.enabled === false ? "" : "checked"}> Agrupar al aplicar</span></label>
      <label>Zona/output principal<select name="primary">${targetOptions(false)}</select></label>
      <fieldset><legend>Miembros</legend><div class="check-list">${(state.outputs || []).map((output) => {
        const value = `output_id:${output.output_id}`;
        return `<label><input type="checkbox" name="member_${escapeHtml(value)}" value="yes" ${members.has(value) ? "checked" : ""}> ${escapeHtml(output.display_name)}</label>`;
      }).join("")}</div></fieldset>
      <fieldset><legend>VolÃºmenes</legend>${volumeRows}<p class="muted">Este preset no reproducirÃ¡ mÃºsica; solo ajustarÃ¡ zonas/volumen.</p></fieldset>`,
    submitLabel: editing ? "Actualizar preset" : "Guardar preset",
    onSubmit: async (data) => {
      const memberRefs = Object.keys(data)
        .filter((key) => key.startsWith("member_") && data[key] === "yes")
        .map((key) => splitTarget(key.slice("member_".length)));
      const volumeTargets = $$("select[name=volume_target]", $("#dialog-fields"));
      const volumeValues = $$("input[name=volume_value]", $("#dialog-fields"));
      const volumes = volumeTargets.map((select, index) => ({
        target_ref: splitTarget(select.value),
        volume: Number(volumeValues[index].value)
      })).filter((item) => Number.isFinite(item.volume));
      const payload = {
        name: data.name,
        description: data.description,
        virtual_zone: { enabled: true, display_name: data.name, show_in_portal: true, show_in_roon_if_supported: false },
        grouping: {
          enabled: data.grouping_enabled === "yes",
          primary_zone_ref: splitTarget(data.primary),
          members: memberRefs.length ? memberRefs : [splitTarget(data.primary)]
        },
        volumes,
        playback: { action: "keep_current" },
        queue: { action: "keep_current" }
      };
      await api(editing ? `/api/zone-presets/${encodeURIComponent(preset.preset_id)}` : "/api/zone-presets", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      toast(editing ? "Preset actualizado" : "Preset creado");
      await loadPresets();
    }
  });
  if (primaryValue) $("#dialog-fields select[name=primary]").value = primaryValue;
  (preset?.volumes || []).forEach((item, index) => {
    const select = $$("select[name=volume_target]", $("#dialog-fields"))[index];
    if (select) select.value = `${item.target_ref.type}:${item.target_ref.value}`;
  });
}

function volumeLimitDialog(limit = null) {
  const editing = Boolean(limit);
  openForm({
    eyebrow: "LÃ­mite seguro",
    title: editing ? "Editar lÃ­mite" : "Crear lÃ­mite de volumen",
    fields: `<label>Nombre<input name="name" required maxlength="80" value="${escapeHtml(limit?.name || "General")}"></label>
      <label>Target<select name="target">${targetOptions(true)}</select></label>
      <label>Safe max<input name="safe_max" type="number" min="1" step="1" required value="${escapeHtml(limit?.safe_max || "")}"></label>
      <label><span><input type="checkbox" name="scheduled" value="yes" ${limit?.schedule ? "checked" : ""}> LÃ­mite con horario</span></label>
      <label>DÃ­as<input name="days" placeholder="mon,tue,wed,thu,fri,sat,sun" value="${escapeHtml(limit?.schedule?.days?.join(",") || "mon,tue,wed,thu,fri,sat,sun")}"></label>
      <label>Desde<input name="from" placeholder="22:30" value="${escapeHtml(limit?.schedule?.from || "")}"></label>
      <label>Hasta<input name="to" placeholder="08:00" value="${escapeHtml(limit?.schedule?.to || "")}"></label>`,
    submitLabel: editing ? "Actualizar lÃ­mite" : "Guardar lÃ­mite",
    onSubmit: async (data) => {
      const schedule = data.scheduled === "yes"
        ? { timezone: "Europe/Madrid", days: data.days.split(",").map((item) => item.trim()).filter(Boolean), from: data.from, to: data.to }
        : null;
      const payload = {
        name: data.name,
        target_ref: splitTarget(data.target),
        safe_max: Number(data.safe_max),
        schedule,
        enabled: true
      };
      await api(editing ? `/api/volume-limits/${encodeURIComponent(limit.limit_id)}` : "/api/volume-limits", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      toast(editing ? "LÃ­mite actualizado" : "LÃ­mite creado");
      await loadPresets();
    }
  });
  if (limit) $("#dialog-fields select[name=target]").value = `${limit.target_ref.type}:${limit.target_ref.value}`;
}

async function testVolumeLimit(limit) {
  const requested = Number(prompt("Volumen solicitado a probar", String(limit.safe_max)));
  if (!Number.isFinite(requested)) return;
  const result = await api("/api/volume-limits/evaluate", {
    method: "POST",
    body: JSON.stringify({ target_ref: limit.target_ref, requested_volume: requested })
  });
  toast(result.policy_result === "allowed" ? "PolÃ­tica permitida" : `PolÃ­tica: ${result.policy_result}`, result.policy_result === "allowed" ? "ok" : "error");
}

async function loadLegacyOutputVolumeSettingsUnused() {
  const [presets, volumes, outputs] = await Promise.all([
    api("/api/admin/zone-presets"),
    api("/api/admin/output-volumes"),
    api("/api/roon/outputs")
  ]);
  state.presets = presets;
  state.outputVolumes = volumes;
  state.outputs = outputs;
  $("#preset-list").innerHTML = presets.length
    ? presets.map((preset) => `
      <div class="preset-card" data-preset="${escapeHtml(preset.preset_id)}">
        <span><strong>${escapeHtml(preset.name)}</strong><small>${preset.output_ids.length} outputs · principal ${escapeHtml(outputs.find((item) => item.output_id === preset.primary_output_id)?.display_name || preset.primary_output_id)}</small></span>
        <span class="track-actions"><button class="button primary" data-apply-preset>Aplicar</button><button class="small-button" data-delete-preset>×</button></span>
      </div>`).join("")
    : `<div class="empty-state">No hay presets. Crea uno con dos o más outputs.</div>`;
  $("#output-volume-list").innerHTML = volumes.length
    ? volumes.map((item) => {
      const settings = item.settings || {};
      return `<div class="volume-settings-row" data-volume-output="${escapeHtml(item.output_id)}">
        <strong>${escapeHtml(item.display_name)}</strong>
        <label>Mínimo<input data-volume-min type="number" step="0.5" value="${settings.minimum_value ?? ""}"></label>
        <label>Máximo<input data-volume-max type="number" step="0.5" value="${settings.maximum_value ?? ""}"></label>
        <label>Preferido<input data-volume-preferred type="number" step="0.5" value="${settings.preferred_value ?? ""}"></label>
        <span><button class="small-button" data-save-output-volume>Guardar</button><button class="small-button" data-apply-output-volume>Aplicar</button></span>
      </div>`;
    }).join("")
    : `<div class="empty-state">Roon todavía no ha publicado outputs.</div>`;
}

function newPresetDialog() {
  if (state.volumeLimits !== undefined) {
    if (!state.outputs?.length) { toast("No hay outputs disponibles", "error"); return; }
    presetDialog();
    return;
  }
  if (!state.outputs?.length) {
    toast("No hay outputs disponibles", "error");
    return;
  }
  openForm({
    eyebrow: "Nueva escena",
    title: "Crear preset de zonas",
    fields: `<label>Nombre<input name="name" required maxlength="80"></label>
      <label>Output principal<select name="primary_output_id">${state.outputs.map((output) => `<option value="${escapeHtml(output.output_id)}">${escapeHtml(output.display_name)}</option>`).join("")}</select></label>
      <fieldset><legend>Outputs incluidos</legend><div class="check-list">${state.outputs.map((output) => `<label><input type="checkbox" name="output_${escapeHtml(output.output_id)}" value="yes"> ${escapeHtml(output.display_name)}</label>`).join("")}</div></fieldset>
      <label><span><input type="checkbox" name="capture_volumes" value="yes" checked> Guardar volúmenes actuales</span></label>`,
    submitLabel: "Guardar preset",
    onSubmit: async (data) => {
      const outputIds = Object.keys(data)
        .filter((key) => key.startsWith("output_") && data[key] === "yes")
        .map((key) => key.slice("output_".length));
      await api("/api/admin/zone-presets", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          primary_output_id: data.primary_output_id,
          output_ids: outputIds,
          capture_volumes: data.capture_volumes === "yes"
        })
      });
      toast("Preset creado");
      await loadPresets();
    }
  });
}

$("#new-preset").addEventListener("click", newPresetDialog);
$("#preset-list").addEventListener("click", async (event) => {
  const card = event.target.closest("[data-preset]");
  if (!card) return;
  try {
    const preset = state.presets.find((item) => item.preset_id === card.dataset.preset);
    if (event.target.closest("[data-preview-preset]")) {
      const result = await api(`/api/zone-presets/${encodeURIComponent(card.dataset.preset)}/dry-run`, {
        method: "POST", body: "{}"
      });
      const blocked = result?.planned_changes?.volumes?.find((item) => item.policy?.requires_confirmation);
      toast(blocked ? `Este preset supera el limite seguro activo para ${blocked.output_name}.` : "Preview correcto: no reproducira musica.", blocked ? "error" : "ok");
      return;
    }
    if (event.target.closest("[data-edit-preset]")) {
      presetDialog(preset);
      return;
    }
    if (state.volumeLimits !== undefined && event.target.closest("[data-apply-preset]")) {
      if (!confirm("Este preset no reproducira musica; solo ajustara zonas/volumen. Aplicar?")) return;
      const result = await api(`/api/zone-presets/${encodeURIComponent(card.dataset.preset)}/apply`, {
        method: "POST", body: "{}"
      });
      toast(result.requires_confirmation ? result.human_summary : "Preset aplicado");
      return;
    }
    if (state.volumeLimits !== undefined && event.target.closest("[data-delete-preset]")) {
      if (!confirm("Eliminar este preset?")) return;
      await api(`/api/zone-presets/${encodeURIComponent(card.dataset.preset)}`, { method: "DELETE" });
      toast("Preset eliminado");
      await loadPresets();
      return;
    }
    if (event.target.closest("[data-apply-preset]")) {
      if (!confirm("RoonIA pausará las zonas afectadas y restaurará la agrupación del preset. ¿Aplicar?")) return;
      await api(`/api/admin/zone-presets/${encodeURIComponent(card.dataset.preset)}/apply`, {
        method: "POST", body: "{}"
      });
      toast("Preset aplicado y verificado");
    }
    if (event.target.closest("[data-delete-preset]")) {
      if (!confirm("¿Eliminar este preset?")) return;
      await api(`/api/admin/zone-presets/${encodeURIComponent(card.dataset.preset)}`, {
        method: "DELETE"
      });
      toast("Preset eliminado");
      await loadPresets();
    }
  } catch (error) { toast(error.message, "error"); }
});
$("#output-volume-list").addEventListener("click", async (event) => {
  if (event.target.closest("[data-new-volume-limit]")) {
    volumeLimitDialog();
    return;
  }
  const limitRow = event.target.closest("[data-volume-limit]");
  if (limitRow) {
    const limit = state.volumeLimits.find((item) => item.limit_id === limitRow.dataset.volumeLimit);
    try {
      if (event.target.closest("[data-test-volume-limit]")) await testVolumeLimit(limit);
      if (event.target.closest("[data-edit-volume-limit]")) volumeLimitDialog(limit);
      if (event.target.closest("[data-delete-volume-limit]")) {
        if (!confirm("Eliminar este limite?")) return;
        await api(`/api/volume-limits/${encodeURIComponent(limit.limit_id)}`, { method: "DELETE" });
        toast("Limite eliminado");
        await loadPresets();
      }
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  const row = event.target.closest("[data-volume-output]");
  if (!row) return;
  const outputId = row.dataset.volumeOutput;
  try {
    if (event.target.closest("[data-save-output-volume]")) {
      await api(`/api/admin/output-volumes/${encodeURIComponent(outputId)}`, {
        method: "PUT",
        body: JSON.stringify({
          minimum_value: $("[data-volume-min]", row).value,
          maximum_value: $("[data-volume-max]", row).value,
          preferred_value: $("[data-volume-preferred]", row).value
        })
      });
      toast("Configuración de volumen guardada");
    }
    if (event.target.closest("[data-apply-output-volume]")) {
      await api(`/api/admin/output-volumes/${encodeURIComponent(outputId)}/apply`, {
        method: "POST", body: "{}"
      });
      toast("Volumen preferido aplicado");
    }
  } catch (error) { toast(error.message, "error"); }
});

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
  const [settings, system] = await Promise.all([
    api("/api/admin/settings"),
    api("/api/admin/system")
  ]);
  state.system = system;
  $("#system-api-port").value = system.api_port;
  $("#system-portal-port").value = system.portal_port;
  $("#system-allow-beta").checked = system.allow_beta_updates === true;
  $("#service-addresses").innerHTML = system.addresses?.length
    ? system.addresses.map((item) => `<code>${escapeHtml(item.portal_url)}</code><code>${escapeHtml(item.api_url)}</code>`).join("")
    : `<span class="muted">No se pudo detectar una dirección IPv4.</span>`;
  const versionStatus = system.version_status || {};
  $("#update-state").textContent = versionStatus.error
    ? "Error al comprobar"
    : versionStatus.update_available
      ? `Disponible ${versionStatus.latest_version}`
      : versionStatus.checked_at
        ? "Al día"
        : "Sin comprobar";
  const groups = [
    ["Servicio", [["Versión", settings.version], ["API HTTP", settings.api_port], ["Portal", settings.portal_port], ["Canal", settings.update_channel || "stable"], ["Entorno", settings.node_environment]]],
    ["Capacidades", [["Browse", settings.browse_enabled], ["MCP", settings.mcp_enabled], ["Fuente", settings.streaming_source || "Sin definir"], ["URL pública", settings.public_base_url]]],
    ["Autenticación", [["API protegida", settings.api_auth_enabled], ["API token", settings.api_token_configured], ["Token del portal", settings.portal_admin_token_configured]]]
  ];
  $("#settings-grid").innerHTML = groups.map(([title, rows]) => `
    <article class="info-card"><p class="eyebrow">${title}</p><h3>${title}</h3>
    ${rows.map(([label, value]) => `<div class="setting-row"><span>${escapeHtml(label)}</span><strong>${typeof value === "boolean" ? (value ? "Sí" : "No") : escapeHtml(value)}</strong></div>`).join("")}</article>`
  ).join("");
}

$("#save-ports").addEventListener("click", async () => {
  try {
    const result = await api("/api/admin/system/ports", {
      method: "PATCH",
      body: JSON.stringify({
        api_port: Number($("#system-api-port").value),
        portal_port: Number($("#system-portal-port").value),
        allow_beta_updates: $("#system-allow-beta").checked
      })
    });
    toast(result.restart_required ? "Configuración guardada; reinicia para aplicarla" : "Configuración guardada");
  } catch (error) { toast(error.message, "error"); }
});
$("#check-update").addEventListener("click", async () => {
  const button = $("#check-update");
  setBusy(button, true);
  try {
    const result = await api("/api/admin/system/check-update", {
      method: "POST", body: "{}"
    });
    $("#update-state").textContent = result.error
      ? "Comprobación fallida"
      : result.update_available
        ? `Disponible ${result.latest_version}`
        : "Al día";
    toast(result.error || (result.update_available ? "Hay una nueva versión" : "RoonIA está al día"), result.error ? "error" : "ok");
  } finally { setBusy(button, false); }
});
$("#request-update").addEventListener("click", async () => {
  const channel = $("#system-allow-beta").checked ? "beta" : "estable";
  if (!confirm(`El LXC descargará la versión ${channel}, reconstruirá Docker y reiniciará RoonIA. ¿Actualizar?`)) return;
  try {
    const result = await api("/api/admin/system/update", {
      method: "POST",
      body: JSON.stringify({ allow_beta_updates: $("#system-allow-beta").checked })
    });
    toast(`Actualización solicitada al LXC (${result.channel || "stable"})`);
  } catch (error) { toast(error.message, "error"); }
});
$("#restart-service").addEventListener("click", async () => {
  if (!confirm("El portal estará desconectado unos segundos. ¿Reiniciar RoonIA?")) return;
  try {
    await api("/api/admin/system/restart", { method: "POST", body: "{}" });
    toast("Reinicio solicitado");
  } catch (error) { toast(error.message, "error"); }
});

$("#setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("button[type=submit]", event.currentTarget);
  setBusy(button, true);
  $("#setup-error").textContent = "";
  try {
    if ($("#setup-password").value !== $("#setup-password-confirm").value) {
      throw new Error("Las contraseñas no coinciden.");
    }
    const result = await api("/api/auth/setup", {
      auth: false,
      method: "POST",
      headers: { Authorization: `Bearer ${$("#setup-bootstrap").value}` },
      body: JSON.stringify({
        username: $("#setup-username").value,
        password: $("#setup-password").value
      })
    });
    await authenticate(result.token);
  } catch (error) { $("#setup-error").textContent = error.message; }
  finally { setBusy(button, false); }
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("button[type=submit]", event.currentTarget);
  setBusy(button, true);
  $("#login-error").textContent = "";
  try {
    const result = await api("/api/auth/login", {
      auth: false,
      method: "POST",
      body: JSON.stringify({
        username: $("#login-username").value,
        password: $("#login-password").value
      })
    });
    await authenticate(result.token);
  } catch (error) { $("#login-error").textContent = error.message; }
  finally { setBusy(button, false); }
});

$("#main-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) navigate(button.dataset.view);
});
$("[data-go=zones]").addEventListener("click", () => navigate("zones"));
$("#refresh").addEventListener("click", () => navigate(state.view));
$("#refresh-actions")?.addEventListener("click", async () => {
  try {
    const actions = await api("/api/observability/actions?limit=8");
    renderActions(actions.actions || []);
  } catch (error) { toast(error.message, "error"); }
});
$("#refresh-logs")?.addEventListener("click", async () => {
  try {
    const logs = await api("/api/logs/recent?limit=8");
    renderTechnicalLogs(logs.logs || []);
  } catch (error) { toast(error.message, "error"); }
});
$("#copy-diagnostics")?.addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#diagnostics-preview").textContent || "");
  toast("Diagnóstico copiado");
});
$("#logout").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
  sessionStorage.removeItem("roonia.portal.token");
  state.token = "";
  await prepareLogin();
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
    if (event.target.closest("[data-restart-queue]")) {
      await api(`/api/roon/zones/${encodeURIComponent(zoneId)}/queue/restart`, {
        method: "POST", body: "{}"
      });
      toast("La cola vuelve a reproducirse desde el primer elemento");
    }
    const seek = event.target.closest("[data-seek]");
    if (seek) {
      const seconds = Number($("[data-seek-seconds]", card).value);
      await api(`/api/roon/zones/${encodeURIComponent(zoneId)}/seek`, {
        method: "POST",
        body: JSON.stringify({ mode: seek.dataset.seek, seconds })
      });
      toast("Seek enviado a Roon");
    }
    const liveZone = state.zones.find((zone) => zone.zone_id === zoneId);
    if (event.target.closest("[data-toggle-shuffle]")) {
      await api(`/api/roon/zones/${encodeURIComponent(zoneId)}/settings`, {
        method: "POST",
        body: JSON.stringify({ shuffle: !liveZone?.playback_settings?.shuffle })
      });
      toast("Shuffle actualizado");
    }
    if (event.target.closest("[data-toggle-radio]")) {
      await api(`/api/roon/zones/${encodeURIComponent(zoneId)}/settings`, {
        method: "POST",
        body: JSON.stringify({ auto_radio: !liveZone?.playback_settings?.auto_radio })
      });
      toast("Auto radio actualizado");
    }
    if (event.target.closest("[data-cycle-loop]")) {
      await api(`/api/roon/zones/${encodeURIComponent(zoneId)}/settings`, {
        method: "POST", body: JSON.stringify({ loop: "next" })
      });
      toast("Modo loop avanzado");
    }
    const mute = event.target.closest("[data-output-mute]");
    if (mute) {
      const output = liveZone?.outputs?.find((item) => item.output_id === mute.dataset.outputMute);
      await api(`/api/roon/outputs/${encodeURIComponent(mute.dataset.outputMute)}/mute`, {
        method: "POST",
        body: JSON.stringify({ action: output?.volume?.is_muted ? "unmute" : "mute" })
      });
      toast(output?.volume?.is_muted ? "Output reactivado" : "Output silenciado");
      await loadZones();
    }
    const step = event.target.closest("[data-output-step]");
    if (step) {
      await api(`/api/roon/outputs/${encodeURIComponent(step.dataset.outputStep)}/volume`, {
        method: "POST",
        body: JSON.stringify({ mode: "relative_step", value: Number(step.dataset.step) })
      });
      toast("Volumen ajustado un paso");
    }
    const power = event.target.closest("[data-output-power]");
    if (power) {
      await api(`/api/roon/outputs/${encodeURIComponent(power.dataset.outputPower)}/power`, {
        method: "POST", body: JSON.stringify({ action: "toggle_standby" })
      });
      toast("Standby alternado");
    }
    const standby = event.target.closest("[data-output-standby]");
    if (standby) {
      await api(`/api/roon/outputs/${encodeURIComponent(standby.dataset.outputStandby)}/power`, {
        method: "POST", body: JSON.stringify({ action: "standby" })
      });
      toast("Output enviado a standby");
    }
    const switchButton = event.target.closest("[data-output-switch]");
    if (switchButton) {
      await api(`/api/roon/outputs/${encodeURIComponent(switchButton.dataset.outputSwitch)}/power`, {
        method: "POST", body: JSON.stringify({ action: "convenience_switch" })
      });
      toast("Output activado");
    }
    if (event.target.closest("[data-ungroup]")) {
      if (!confirm("¿Separar todos los outputs de este grupo?")) return;
      await api(`/api/roon/zones/${encodeURIComponent(zoneId)}/ungroup`, { method: "POST", body: "{}" });
      toast("Zonas separadas y verificadas");
      await loadZones();
    }
  } catch (error) { toast(error.message, "error"); }
});
$("#pause-all").addEventListener("click", async () => {
  try {
    await api("/api/roon/pause-all", { method: "POST", body: "{}" });
    toast("Todas las zonas han sido pausadas");
    await loadZones();
  } catch (error) { toast(error.message, "error"); }
});
$("#mute-all").addEventListener("click", async () => {
  const button = $("#mute-all");
  const action = button.dataset.muted === "true" ? "unmute" : "mute";
  try {
    await api("/api/roon/mute-all", {
      method: "POST", body: JSON.stringify({ action })
    });
    button.dataset.muted = String(action === "mute");
    button.textContent = action === "mute" ? "Reactivar todo" : "Silenciar todo";
    toast(action === "mute" ? "Todos los outputs silenciados" : "Outputs reactivados");
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

$("#widget-refresh")?.addEventListener("click", async () => {
  try { await loadWidgets(); toast("Widgets actualizados"); }
  catch (error) { toast(error.message, "error"); }
});
$("#widget-now-playing")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-widget-now]");
  const card = event.target.closest("[data-zone]");
  if (!button || !card) return;
  try {
    const result = await api("/api/widgets/now-playing/action", {
      method: "POST",
      body: JSON.stringify({ action: button.dataset.widgetNow, zone_id: card.dataset.zone })
    });
    if (result.requires_confirmation) {
      toast(result.human_summary || "La acción requiere confirmación", "error");
      return;
    }
    toast("Acción enviada");
    await loadWidgets();
  } catch (error) { toast(error.message, "error"); }
});
$("#widget-playlists")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-widget-open-playlist]");
  if (!button) return;
  try {
    const detail = await api(`/api/widgets/playlists/${encodeURIComponent(button.dataset.widgetOpenPlaylist)}`);
    renderWidgetPlaylistDetail(detail);
  } catch (error) { toast(error.message, "error"); }
});
$("#widget-playlist-detail")?.addEventListener("click", async (event) => {
  const playlistId = $("#widget-playlist-detail").dataset.playlist;
  if (!playlistId) return;
  const playlistAction = event.target.closest("[data-widget-playlist-action]");
  const trackAction = event.target.closest("[data-widget-track]");
  const trackRow = event.target.closest("[data-track]");
  if (!playlistAction && !trackAction) return;
  try {
    await api("/api/widgets/playlists/action", {
      method: "POST",
      body: JSON.stringify({
        action: playlistAction?.dataset.widgetPlaylistAction || trackAction.dataset.widgetTrack,
        playlist_id: playlistId,
        track_id: trackRow?.dataset.track,
        zone_id: widgetSelectedZone()
      })
    });
    toast("Playlist enviada a Roon");
  } catch (error) { toast(error.message, "error"); }
});
$("#widget-search-submit")?.addEventListener("click", async () => {
  try {
    const type = $("#widget-search-type").value;
    const payload = await api("/api/widgets/search", {
      method: "POST",
      body: JSON.stringify({
        query: $("#widget-search-query").value,
        types: type ? [type] : undefined,
        zone_id: widgetSelectedZone()
      })
    });
    renderWidgetSearch(payload);
  } catch (error) { toast(error.message, "error"); }
});
$("#widget-search-results")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-widget-search]");
  const row = event.target.closest("[data-result]");
  if (!button || !row) return;
  try {
    const result = await api("/api/widgets/search/action", {
      method: "POST",
      body: JSON.stringify({
        action: button.dataset.widgetSearch,
        result_id: row.dataset.result,
        zone_id: widgetSelectedZone()
      })
    });
    if (result.widget) renderWidgetSearch(result.widget);
    toast("Acción de búsqueda completada");
  } catch (error) { toast(error.message, "error"); }
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
    if (event.target.closest("[data-validate-playlist]")) await validateSelectedPlaylist(playlist);
    if (event.target.closest("[data-dedupe-playlist]")) await dedupeSelectedPlaylist(playlist);
    if (event.target.closest("[data-export-playlist]")) await exportSelectedPlaylist(playlist);
    if (event.target.closest("[data-search-add-track]")) searchCandidateDialog(playlist);
    if (event.target.closest("[data-delete-playlist]")) {
      if (!confirm(`¿Eliminar “${playlist.name}” y todas sus pistas?`)) return;
      await api(`/api/playlists/${encodeURIComponent(playlist.playlist_id)}`, { method: "DELETE" });
      state.selectedPlaylistId = null;
      toast("Playlist eliminada");
      await loadPlaylists();
    }
    const trackRow = event.target.closest("[data-track]");
    const move = event.target.closest("[data-move]");
    const track = trackRow ? playlist.tracks.find((item) => item.track_id === trackRow.dataset.track) : null;
    if (trackRow && event.target.closest("[data-edit-user-metadata]") && track) editUserMetadataDialog(playlist, track);
    if (trackRow && event.target.closest("[data-match-track]") && track) searchCandidateDialog(playlist, track);
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

async function prepareLogin(message = "") {
  try {
    const status = await api("/api/auth/status", { auth: false });
    $("#setup-form").hidden = !status.setup_required;
    $("#login-form").hidden = status.setup_required;
    $("#login-eyebrow").textContent = status.setup_required ? "Primer inicio" : "Roon AI Bridge";
    $("#login-title").innerHTML = status.setup_required
      ? "Crea tu<br>administrador."
      : "Tu música.<br>Todo bajo control.";
    $("#login-description").textContent = status.setup_required
      ? "El token bootstrap confirma que eres el propietario de esta instalación."
      : "Accede con tu usuario administrador.";
    showLogin(message);
  } catch (error) {
    showLogin(error.message);
  }
}

(async () => {
  if (!state.token) { await prepareLogin(); return; }
  try { await authenticate(state.token); }
  catch {
    sessionStorage.removeItem("roonia.portal.token");
    state.token = "";
    await prepareLogin("La sesión anterior ya no es válida.");
  }
})();

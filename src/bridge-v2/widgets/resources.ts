import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const WIDGET_V2_VERSION = "v16";
export const WIDGET_V2_URIS = {
  nowPlaying: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/now-playing.html`,
  media: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/media.html`,
  playlist: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/playlist.html`
} as const;

export const widgetV2Html = `
<main id="app" class="shell" aria-live="polite">
  <header class="header">
    <svg class="logo" viewBox="0 0 1983 793" role="img" aria-label="roonIA logo">
      <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="28">
        <path d="M166 542 L166 354 C166 297 211 254 266 254 L294 254" stroke="#678475"/>
        <circle cx="468" cy="397" r="145" stroke="#678475"/>
        <circle cx="832" cy="397" r="145" stroke="#678475"/>
        <path d="M1046 542 L1046 361 C1046 300 1096 254 1167 254 C1238 254 1285 300 1285 361 L1285 542" stroke="#678475"/>
        <path d="M1410 254 L1410 542" stroke="#C16048"/>
        <path d="M1494 542 L1615 258 C1622 242 1646 242 1653 258 L1772 542" stroke="#C16048"/>
        <path d="M1548 424 L1718 424" stroke="#C16048"/>
      </g>
    </svg>
    <span id="view-label" class="view-label">RoonIA</span>
  </header>
  <section id="content" class="content"><p class="empty">Preparando información…</p></section>
</main>
<style>
  :root{color-scheme:dark;--bg:#090b0a;--bg-soft:#0f1211;--surface:#151917;--line:rgba(235,239,236,.11);--line-strong:rgba(235,239,236,.22);--text:#f2f3f1;--text-soft:#b2b8b4;--text-dim:#737b76;--green:#678475;--green-light:#92ab9e;--orange:#c16048;--orange-light:#e07a5e;font-family:"DM Sans",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  *{box-sizing:border-box}html,body{margin:0;min-width:260px;background:transparent;color:var(--text)}
  .shell{width:100%;max-width:900px;margin:0 auto;padding:16px 18px 20px;background:var(--bg);border:1px solid var(--line);overflow:hidden}
  .header{height:40px;display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:13px;border-bottom:1px solid var(--line)}
  .logo{display:block;width:94px;height:auto}.view-label{color:var(--text-dim);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
  .content{padding-top:16px}.overline{margin:0 0 5px;color:var(--orange-light);font-size:9px;font-weight:700;letter-spacing:.17em;text-transform:uppercase}
  h1,h2,h3,p{margin-top:0}h1{margin-bottom:6px;font-size:clamp(24px,5vw,38px);font-weight:600;line-height:1;letter-spacing:-.045em}h2{margin-bottom:4px;font-size:18px;letter-spacing:-.035em}h3{margin-bottom:3px;font-size:13px;letter-spacing:-.02em}
  .muted{color:var(--text-dim)}.subtitle{margin:0;color:var(--text-soft);font-size:12px;line-height:1.45}.description{max-width:660px;margin:9px 0 0;color:var(--text-dim);font-size:11px;line-height:1.55}
  .art{overflow:hidden;aspect-ratio:1;background:linear-gradient(145deg,#202824,#101311);border:1px solid var(--line)}.art img{display:block;width:100%;height:100%;object-fit:cover}.art.placeholder{display:grid;place-items:center;color:var(--green-light);background:radial-gradient(circle at 50% 35%,rgba(146,171,158,.18),transparent 34%),linear-gradient(145deg,#202824,#101311)}.art.placeholder svg{width:42%;height:42%;fill:none;stroke:currentColor;stroke-width:1.7}
  .now-list{display:grid;gap:1px;background:var(--line)}.now-card{display:grid;grid-template-columns:112px minmax(0,1fr);gap:18px;padding:16px;background:var(--bg-soft)}.now-copy{min-width:0;align-self:center}.now-copy h2{font-size:22px}.song{margin:8px 0 3px;font-size:16px;font-weight:650;line-height:1.2}.album{margin:2px 0 0;color:var(--text-dim);font-size:11px}
  .outputs{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.output{display:flex;align-items:center;gap:7px;min-height:27px;padding:0 8px;border:1px solid var(--line);font-size:10px}.output span{color:var(--text-dim)}.output strong{font-weight:650}.output .muted-state{color:var(--orange-light)}
  .hero{display:grid;grid-template-columns:120px minmax(0,1fr);gap:20px;align-items:center;padding:4px 0 18px}.hero-copy{min-width:0}.hero .art{width:120px}.quality{display:inline-block;margin-top:9px;padding:4px 6px;border:1px solid var(--line);color:var(--text-dim);font-size:9px}
  .section{margin-top:22px}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid var(--line)}.section-head h2{margin:0;font-size:16px}.count{color:var(--text-dim);font-size:9px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:1px;background:var(--line)}.card{min-width:0;padding:9px;background:var(--bg-soft)}.card h3{margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card p{margin:0;overflow:hidden;color:var(--text-dim);font-size:9px;text-overflow:ellipsis;white-space:nowrap}
  .rows{display:grid}.row{display:grid;grid-template-columns:26px 42px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:56px;padding:7px 3px;border-bottom:1px solid var(--line)}.index{color:var(--text-dim);font-size:9px;text-align:center}.cover{width:42px;height:42px}.row-copy{min-width:0}.row-copy strong,.row-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-copy strong{font-size:11px}.row-copy small{margin-top:3px;color:var(--text-dim);font-size:9px}.duration{color:var(--text-dim);font-size:9px}
  .search-title{margin-bottom:13px}.best-match{max-width:560px;display:grid;grid-template-columns:72px minmax(0,1fr);gap:13px;align-items:center;margin:0 0 20px;padding:11px 13px;border:1px solid var(--green);border-left:3px solid var(--green-light);background:linear-gradient(135deg,rgba(103,132,117,.18),var(--bg-soft))}.best-match .art{width:72px}.best-match h2{font-size:18px}.best-match p:last-child{margin:0;color:var(--text-soft);font-size:11px}.empty{margin:0;padding:26px 8px;color:var(--text-dim);font-size:12px;text-align:center}.warning{margin:16px 0 0;padding-top:10px;border-top:1px solid var(--line);color:var(--text-dim);font-size:9px}
  @media(max-width:520px){.shell{padding:13px}.header{height:35px}.logo{width:82px}.now-card{grid-template-columns:78px 1fr;gap:12px;padding:12px}.now-copy h2{font-size:17px}.song{font-size:13px}.hero{grid-template-columns:82px 1fr;gap:13px}.hero .art{width:82px}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.row{grid-template-columns:20px 36px minmax(0,1fr)}.cover{width:36px;height:36px}.duration{display:none}}
</style>
<script type="module">
  const content=document.getElementById("content"),label=document.getElementById("view-label");
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){if(ch==="&")return "&amp;";if(ch==="<")return "&lt;";if(ch===">")return "&gt;";if(ch.charCodeAt(0)===34)return "&quot;";return "&#39;";})}
  function attr(value){return esc(value)}
  function placeholder(type){if(type==="artist")return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 21c.7-4.4 3.2-6.6 7.5-6.6s6.8 2.2 7.5 6.6"></path></svg>';if(type==="album")return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="2.2"></circle><path d="M12 3v3M21 12h-3"></path></svg>';return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>'}
  function art(url,kind,type){return url?'<div class="'+(kind||"art")+'"><img src="'+attr(url)+'" alt="" loading="lazy"></div>':'<div class="'+(kind||"art")+' placeholder">'+placeholder(type)+'</div>'}
  function time(value){const n=Number(value);if(!Number.isFinite(n)||n<=0)return "";return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0")}
  function section(title,items,renderer){if(!items||!items.length)return "";return '<section class="section"><div class="section-head"><h2>'+esc(title)+'</h2><span class="count">'+items.length+'</span></div>'+renderer(items)+'</section>'}
  function card(item){const subtitle=[item.artist||item.album_artist||item.subtitle,item.release_year].filter(Boolean).join(" · ");return '<article class="card">'+art(item.image_url,"art",item.media_type)+'<h3>'+esc(item.title)+'</h3><p>'+esc(subtitle)+'</p></article>'}
  function cards(items){return '<div class="cards">'+items.map(card).join("")+'</div>'}
  function row(item,index){const detail=[item.artist,item.album].filter(Boolean).join(" · ");return '<div class="row"><span class="index">'+esc(item.position||item.track_number||index+1)+'</span>'+art(item.image_url,"art cover","track")+'<span class="row-copy"><strong>'+esc(item.title)+'</strong><small>'+esc(detail)+'</small></span><span class="duration">'+time(item.duration_seconds)+'</span></div>'}
  function rows(items){return '<div class="rows">'+items.map(row).join("")+'</div>'}
  function warning(data){return data.warnings&&data.warnings.length?'<p class="warning">'+esc(data.warnings.join(" · "))+'</p>':""}
  function hero(item,kicker,description){const quality=item.quality&&item.quality.label?'<span class="quality">'+esc(item.quality.label)+'</span>':"";return '<section class="hero">'+art(item.image_url,"art",item.media_type)+'<div class="hero-copy"><p class="overline">'+esc(kicker)+'</p><h1>'+esc(item.title)+'</h1><p class="subtitle">'+esc([item.artist||item.album_artist,item.album,item.release_year].filter(Boolean).join(" · "))+'</p>'+(description?'<p class="description">'+esc(description)+'</p>':"")+quality+'</div></section>'}
  function renderNow(data){const zones=data.zones||[];label.textContent="En reproducción";if(!zones.length){const name=data.requested_zone&&data.requested_zone.name;return '<p class="empty">'+esc(name?"No hay nada reproduciéndose en "+name+".":"No hay ninguna zona reproduciendo en este momento.")+'</p>'}return '<div class="now-list">'+zones.map(function(zone){const media=zone.media||{};const outputs=(zone.outputs||[]).map(function(output){const volume=output.volume;const value=!volume?"—":volume.muted?"Silenciado":volume.value==null?"—":String(volume.value);return '<span class="output"><span>'+esc(output.name)+'</span><strong class="'+(volume&&volume.muted?"muted-state":"")+'">'+esc(value)+'</strong></span>'}).join("");return '<article class="now-card">'+art(media.image_url)+'<div class="now-copy"><p class="overline">'+esc(zone.name)+'</p><p class="song">'+esc(media.title||"Sin título")+'</p><p class="subtitle">'+esc(media.artist||"")+'</p><p class="album">'+esc(media.album||"")+'</p><div class="outputs">'+outputs+'</div></div></article>'}).join("")+'</div>'}
  function renderSearch(data){label.textContent="Resultados";const groups=data.groups||{},best=data.best_match;const bestHtml=best?'<section class="best-match">'+art(best.image_url,"art",best.media_type)+'<div><p class="overline">Mejor resultado · '+esc(best.release_type&&best.release_type!=="unknown"?best.release_type:best.media_type)+'</p><h2>'+esc(best.title)+'</h2><p>'+esc(best.artist||best.album_artist||best.subtitle||"")+'</p></div></section>':"";const grouped=section("Artistas",groups.artist,cards)+section("Álbumes",groups.album,cards)+section("EPs",groups.ep,cards)+section("Singles / EPs",groups.single_ep,cards)+section("Singles",groups.single,cards)+section("Canciones",groups.track,rows)+section("Playlists",groups.playlist,cards);return '<div class="search-title"><p class="overline">Búsqueda</p><h2>'+esc(data.title)+'</h2></div>'+bestHtml+(grouped||'<p class="empty">No se encontraron resultados.</p>')+warning(data)}
  function renderArtist(data){label.textContent="Artista";return hero(data.artist||{},"Artista",null)+section("Canciones populares",data.popular_tracks,rows)+section("Álbumes",data.albums,cards)+section("EPs",data.eps,cards)+section("Singles",data.singles,cards)+section("Singles / EPs",data.mixed_releases,cards)+warning(data)}
  function renderAlbum(data){label.textContent="Álbum";return hero(data.album||{},"Álbum",data.description)+section("Canciones",data.tracks,rows)+warning(data)}
  function renderTrack(data){label.textContent="Canción";return hero(data.track||{},"Canción",null)+warning(data)}
  function renderPlaylist(data){const list=data.playlist||{};label.textContent="Playlist";return hero({title:list.name,image_url:list.image_url,artist:list.track_count+" canciones"},"Playlist",list.description)+section("Canciones",data.tracks,rows)+(data.pagination&&data.pagination.has_more?'<p class="warning">Mostrando '+esc(data.pagination.returned)+' de '+esc(data.pagination.total)+' canciones.</p>':"")}
  function render(data){if(!data)return;let html;if(data.view==="now_playing")html=renderNow(data);else if(data.view==="search_results")html=renderSearch(data);else if(data.view==="artist")html=renderArtist(data);else if(data.view==="album")html=renderAlbum(data);else if(data.view==="track")html=renderTrack(data);else if(data.view==="playlist")html=renderPlaylist(data);else html='<p class="empty">Vista no disponible.</p>';content.innerHTML=html}
  function widgetFrom(result){if(!result)return null;const candidates=[result,result._meta,result.structuredContent,result.mcp_tool_result,result.call_tool_result,result._meta&&result._meta.mcp_tool_result,result._meta&&result._meta.call_tool_result,result.mcp_tool_result&&result.mcp_tool_result._meta,result.call_tool_result&&result.call_tool_result._meta];for(const item of candidates){if(item&&item.widget)return item.widget;if(item&&item.structuredContent&&item.structuredContent.widget)return item.structuredContent.widget;if(item&&item._meta&&item._meta.widget)return item._meta.widget}return null}
  function applyGlobals(globals){render(widgetFrom(globals&&globals.toolResponseMetadata)||widgetFrom(globals&&globals.toolOutput))}
  applyGlobals(window.openai||{});
  window.addEventListener("openai:set_globals",function(event){applyGlobals(event.detail&&event.detail.globals)},{passive:true});
  window.addEventListener("message",function(event){if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=="2.0"||message.method!=="ui/notifications/tool-result")return;render(widgetFrom(message.params))},{passive:true});
</script>
`.trim();

export function registerWidgetV2Resources(server: McpServer): void {
  const titles: Record<keyof typeof WIDGET_V2_URIS, string> = {
    nowPlaying: "RoonIA Now Playing",
    media: "RoonIA Music Information",
    playlist: "RoonIA Playlist"
  };
  for (const [surface, uri] of Object.entries(WIDGET_V2_URIS) as Array<[keyof typeof WIDGET_V2_URIS, string]>) {
    server.registerResource(
      `roonia-${surface}-widget-v3`,
      uri,
      {
        title: titles[surface],
        description: `${titles[surface]} compact read-only widget.`
      },
      async () => ({
        contents: [{
          uri,
          mimeType: "text/html;profile=mcp-app",
          text: widgetV2Html,
          _meta: {
            ui: {
              prefersBorder: true,
              domain: "https://roonia.ipchome.com",
              csp: {
                connectDomains: [],
                resourceDomains: ["https://roonia.ipchome.com"]
              }
            },
            "openai/widgetDescription": "Vista compacta y de solo lectura de RoonIA con carátulas y metadatos musicales.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetDomain": "https://roonia.ipchome.com",
            "openai/widgetCSP": {
              connect_domains: [],
              resource_domains: ["https://roonia.ipchome.com"]
            }
          }
        }]
      })
    );
  }
}

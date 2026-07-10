const path = require("node:path");
const express = require("express");

const app = express();
const root = path.resolve(__dirname, "..");
app.use(express.json());

const albums = {
  moon: ["#dba766", "#37261e", "Moon Safari", "AIR"],
  radio: ["#6c8095", "#191e24", "In Rainbows", "Radiohead"],
  cave: ["#9d322d", "#140d0c", "Push the Sky Away", "Nick Cave"],
  cooper: ["#6b796b", "#111811", "Unspoken Words", "Max Cooper"],
  massive: ["#a46e5c", "#241915", "Mezzanine", "Massive Attack"],
  kraft: ["#c63b30", "#f0e0cb", "The Man-Machine", "Kraftwerk"],
  eno: ["#667c8a", "#d1d0c4", "Ambient 1", "Brian Eno"],
  moderat: ["#35393c", "#a7b4b5", "II", "Moderat"]
};
const zones = [
  { zone_id:"salon", display_name:"Salón", state:"playing", now_playing:{ image_key:"moon", three_line:{ line1:"La femme d'argent", line2:"AIR", line3:"Moon Safari" } }, outputs:[{ output_id:"salon-out", display_name:"Naim Uniti Atom", volume:{ value:38,min:0,max:100,step:1 } }] },
  { zone_id:"despacho", display_name:"Despacho", state:"paused", now_playing:{ image_key:"radio", three_line:{ line1:"Weird Fishes / Arpeggi", line2:"Radiohead", line3:"In Rainbows" } }, outputs:[{ output_id:"desk-out", display_name:"RME ADI-2 DAC", volume:{ value:24,min:0,max:100,step:1 } }] },
  { zone_id:"cocina", display_name:"Cocina", state:"stopped", now_playing:null, outputs:[{ output_id:"kitchen-out", display_name:"Bluesound Pulse", volume:{ value:31,min:0,max:100,step:1 } }] }
];
const media = [
  { result_id:"artist-air",media_type:"artist",title:"AIR",subtitle:"French electronic duo",artist:"AIR",image_key:"moon",source:"library",is_library:true },
  { result_id:"artist-radiohead",media_type:"artist",title:"Radiohead",subtitle:"Oxford, England",artist:"Radiohead",image_key:"radio",source:"library",is_library:true },
  { result_id:"album-moon",media_type:"album",title:"Moon Safari",subtitle:"AIR · 1998",artist:"AIR",image_key:"moon",source:"qobuz",quality:{label:"24-bit / 96 kHz"} },
  { result_id:"album-rainbows",media_type:"album",title:"In Rainbows",subtitle:"Radiohead · 2007",artist:"Radiohead",image_key:"radio",source:"library",is_library:true },
  { result_id:"track-femme",media_type:"track",title:"La femme d'argent",artist:"AIR",album:"Moon Safari",image_key:"moon",source:"qobuz",is_best_match:true,quality:{label:"24-bit / 96 kHz"} },
  { result_id:"track-weird",media_type:"track",title:"Weird Fishes / Arpeggi",artist:"Radiohead",album:"In Rainbows",image_key:"radio",source:"library",is_library:true },
  { result_id:"track-hand",media_type:"track",title:"Red Right Hand",artist:"Nick Cave & The Bad Seeds",album:"Let Love In",image_key:"cave",source:"tidal" },
  { result_id:"track-repetition",media_type:"track",title:"Repetition",artist:"Max Cooper",album:"Yearning for the Infinite",image_key:"cooper",source:"qobuz",quality:{label:"24-bit / 96 kHz"} },
  { result_id:"playlist-roon",media_type:"playlist",title:"Late Night Focus",subtitle:"Roon playlist · 42 tracks",image_key:"eno",source:"playlist" }
];
media.push(
  ...[["artist-cave","Nick Cave & The Bad Seeds","cave"],["artist-cooper","Max Cooper","cooper"],["artist-massive","Massive Attack","massive"],["artist-kraft","Kraftwerk","kraft"],["artist-eno","Brian Eno","eno"],["artist-moderat","Moderat","moderat"]].map(([result_id,title,image_key])=>({result_id,media_type:"artist",title,subtitle:"Artista",artist:title,image_key,source:"qobuz"})),
  ...[["album-cave","Push the Sky Away","Nick Cave & The Bad Seeds","cave"],["album-cooper","Unspoken Words","Max Cooper","cooper"],["album-massive","Mezzanine","Massive Attack","massive"],["album-kraft","The Man-Machine","Kraftwerk","kraft"],["album-eno","Ambient 1","Brian Eno","eno"],["album-moderat","II","Moderat","moderat"]].map(([result_id,title,artist,image_key])=>({result_id,media_type:"album",title,subtitle:`${artist} · Álbum`,artist,image_key,source:"qobuz"})),
  ...Array.from({length:12},(_,index)=>({result_id:`track-preview-${index}`,media_type:"track",title:`Pista destacada ${index+1}`,artist:index%2?"Radiohead":"AIR",album:index%2?"In Rainbows":"Moon Safari",image_key:index%2?"radio":"moon",source:"library"}))
);
const playlists = [
  { playlist_id:"night",name:"After dark",description:"Electronic, ambient and slow-burning records.",cover_image_key:"cooper",tracks_count:28,tracks:[] },
  { playlist_id:"sunday",name:"Sunday morning",description:"Quiet records for a slow start.",cover_image_key:"eno",tracks_count:19,tracks:[] },
  { playlist_id:"essentials",name:"All-time essentials",description:"Records that never leave the rotation.",cover_image_key:"massive",tracks_count:64,tracks:[] },
  { playlist_id:"machines",name:"Machines & humans",description:"Krautrock, electro and modern minimalism.",cover_image_key:"kraft",tracks_count:35,tracks:[] }
];
const customCovers = new Map();
const keys = [
  { key_id:"chatgpt",name:"ChatGPT · Casa",key_prefix:"rnb_9L2kP…",role:"control",created_at:"2026-07-01T11:00:00Z",last_used_at:"2026-07-10T08:21:00Z",revoked_at:null,tool_permissions:null },
  { key_id:"tablet",name:"Tablet del salón",key_prefix:"rnb_a8N1s…",role:"read",created_at:"2026-06-21T17:00:00Z",last_used_at:"2026-07-09T22:10:00Z",revoked_at:null,tool_permissions:["roon_status","roon_list_zones","roon_get_now_playing_widget"] },
  { key_id:"old",name:"Integración antigua",key_prefix:"rnb_v2Old…",role:"control",created_at:"2026-04-02T09:00:00Z",last_used_at:"2026-05-11T15:00:00Z",revoked_at:"2026-06-01T10:00:00Z",tool_permissions:null }
];
const toolNames = ["roon_status","roon_list_zones","roon_get_now_playing_widget","roon_search_media","roon_play_media","roon_add_media_to_queue","roon_control_playback","roon_change_volume","roon_group_zones","roon_transfer_playback","roon_list_virtual_playlists","roon_create_virtual_playlist","roon_add_virtual_playlist_track","roon_apply_zone_preset"];
const tools = toolNames.map((name,index)=>({ name,title:name.replace("roon_","").replaceAll("_"," "),description:index<4?"Consulta el estado y la biblioteca de Roon sin modificar la reproducción.":"Ejecuta una acción verificada sobre reproducción, zonas o colecciones.",enabled:index!==13,classification:{read_only:index<4,mutation:index>=4,destructive:false} }));

app.get("/assets/brand/:file", (req,res) => res.sendFile(path.join(root,"logos",req.params.file)));
app.get("/api/roon/images/:key", (req,res) => {
  const [a,b,title,artist] = albums[req.params.key] || ["#66776e","#202520","roonIA","Music"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><filter id="n"><feTurbulence baseFrequency=".75" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .12"/></feComponentTransfer></filter><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><rect width="800" height="800" filter="url(#n)"/><circle cx="620" cy="160" r="210" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="4"/><circle cx="620" cy="160" r="120" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/><text x="55" y="620" fill="white" font-family="Arial" font-size="52" font-weight="700">${title}</text><text x="58" y="675" fill="rgba(255,255,255,.72)" font-family="Arial" font-size="25" letter-spacing="6">${artist.toUpperCase()}</text></svg>`;
  res.type("image/svg+xml").send(svg);
});
app.get("/api/auth/status", (_req,res)=>res.json({setup_required:false}));
app.post("/api/auth/login", (_req,res)=>res.json({token:"preview"}));
app.post("/api/auth/logout", (_req,res)=>res.json({ok:true}));
app.use("/api", (req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
app.get("/api/session", (_req,res)=>res.json({ok:true,version:"0.16.1",user:{username:"iago"}}));
app.get("/api/dashboard", (_req,res)=>res.json({version:"0.16.1",status:{core_connected:true,core_name:"Roon Server · Nucleus",transport_ready:true,browse_ready:true},counts:{zones:3,playing_zones:1,playlists:4,playlist_tracks:146,active_api_keys:2,mcp_tools:14,recent_errors:0},recent_actions:[{tool_or_endpoint:"roon_play_media",source:"mcp",timestamp:"2026-07-10T08:19:00Z"},{tool_or_endpoint:"/zones/salon/volume",source:"portal",timestamp:"2026-07-10T08:16:00Z"}],now_playing:[]}));
app.get("/api/roon/zones",(_req,res)=>res.json(zones));
app.get("/api/roon/outputs",(_req,res)=>res.json(zones.flatMap(z=>z.outputs)));
app.get("/api/roon/media/search",(req,res)=>res.json({query:req.query.q||"radiohead",results:media,ambiguous:false}));
app.get("/api/roon/media/:id/releases",(_req,res)=>res.json({releases:media.filter(x=>x.media_type==="album")}));
app.get("/api/roon/media/:id/artist-detail",(req,res)=>{const artist=media.find(x=>x.result_id===req.params.id)||media.find(x=>x.media_type==="artist");res.json({artist,bio:"Una breve biografía editorial proporcionada por Roon para contextualizar la trayectoria, el sonido y la discografía esencial del artista.",popular_tracks:media.filter(x=>x.media_type==="track").slice(0,12),albums:media.filter(x=>x.media_type==="album").slice(0,6),singles_eps:media.filter(x=>x.media_type==="album").slice(6,8),warnings:[]});});
app.get("/api/roon/media/:id/album-detail",(req,res)=>{const album=media.find(x=>x.result_id===req.params.id)||media.find(x=>x.media_type==="album");res.json({album,description:"Edición disponible en la biblioteca y los servicios conectados a Roon.",tracks:media.filter(x=>x.media_type==="track").slice(0,12),warnings:[]});});
app.get("/api/roon/media/:id",(req,res)=>res.json(media.find(x=>x.result_id===req.params.id)||media[0]));
app.post("/api/roon/media/:id/:action",(_req,res)=>res.json({ok:true,state_verified:true}));
app.get("/api/playlists",(_req,res)=>res.json({playlists,total:playlists.length}));
app.post("/api/playlists",(req,res)=>{const playlist={playlist_id:`preview-${Date.now()}`,name:req.body.name,description:req.body.description||null,cover_image_key:null,tracks_count:0,tracks:[]};playlists.unshift(playlist);res.status(201).json(playlist);});
app.patch("/api/playlists/:id",(req,res)=>{const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];Object.assign(p,{name:req.body.name??p.name,description:req.body.description??p.description});res.json(p);});
app.post("/api/playlists/:id/cover",(req,res)=>{const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];const match=String(req.body.data_url||"").match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);if(match){const id=`preview-${Date.now()}.${match[1].split('/')[1]}`;customCovers.set(id,{type:match[1],bytes:Buffer.from(match[2],"base64")});p.cover_image_key=`custom:${id}`;}res.json(p);});
app.delete("/api/playlists/:id/cover",(req,res)=>{const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];p.cover_image_key=null;res.json(p);});
app.get("/api/playlists/covers/:id",(req,res)=>{const image=customCovers.get(req.params.id);if(!image)return res.sendStatus(404);res.type(image.type).send(image.bytes);});
app.get("/api/playlists/:id",(req,res)=>{const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];res.json({...p,tracks:media.filter(x=>x.media_type==="track").map((x,i)=>({track_id:`t${i}`,title:x.title,artist:x.artist,album:x.album,image_key:x.image_key,query:`${x.title} ${x.artist}`}))});});
app.get("/api/roon/library",(_req,res)=>res.json({list:{title:"Recently added",count:8},items:Object.entries(albums).map(([key,v])=>({item_key:key,title:v[2],subtitle:v[3],image_key:key,hint:"list"}))}));
app.get("/api/roon/queue/:id",(_req,res)=>res.json({items:media.filter(x=>x.media_type==="track")}));
app.get("/api/zone-presets",(_req,res)=>res.json([{preset_id:"whole-house",name:"Toda la casa",description:"Salón y cocina sincronizados",grouping:{members:[1,2]},volumes:[1,2]},{preset_id:"work",name:"Concentración",description:"Despacho a volumen bajo",grouping:{members:[1]},volumes:[1]}]));
app.get("/api/volume-limits",(_req,res)=>res.json([{limit_id:"night",name:"Noche",target_ref:{type:"global",value:"global"},safe_max:42,schedule:{}}]));
app.get("/api/admin/output-volumes",(_req,res)=>res.json(zones.flatMap(z=>z.outputs).map(o=>({output_id:o.output_id,display_name:o.display_name,current_volume:o.volume,settings:{preferred_value:o.volume.value,minimum_value:0,maximum_value:70}}))));
app.get("/api/admin/api-keys",(_req,res)=>res.json(keys));
app.get("/api/admin/tools",(_req,res)=>res.json({tools,tools_count:tools.length,enabled_tools_count:tools.filter(x=>x.enabled).length}));
app.get("/api/observability/actions",(_req,res)=>res.json({actions:[{tool_or_endpoint:"roon_play_media",source:"mcp",timestamp:"2026-07-10T08:19:00Z"},{tool_or_endpoint:"roon_change_volume",source:"portal",timestamp:"2026-07-10T08:16:00Z"},{tool_or_endpoint:"roon_search_media",source:"mcp",timestamp:"2026-07-10T08:14:00Z"}]}));
app.get("/api/logs/recent",(_req,res)=>res.json({events:[{message:"Roon Core discovery ready",component:"roon",level:"info",timestamp:"2026-07-10T08:00:00Z"}]}));
app.get("/api/diagnostics/bundle",(_req,res)=>res.json({http:{ready:true},roon:{core_connected:true,zones_count:3},mcp:{tools_count:14},recent_errors:[]}));
app.get("/api/admin/settings",(_req,res)=>res.json({version:"0.16.1",api_port:3000,portal_port:3001,public_base_url:"https://roonia.ipchome.com",browse_enabled:true,mcp_enabled:true,api_auth_enabled:true,streaming_source:"qobuz",allow_beta_updates:false}));
app.get("/api/admin/system",(_req,res)=>res.json({addresses:[{interface:"Portal",portal_url:"http://10.0.60.38:3001"}],runtime_config:{api_port:3000,portal_port:3001}}));
app.all("/api/*",(_req,res)=>res.json({ok:true}));
app.use(express.static(path.join(root,"portal")));
app.get("*",(_req,res)=>res.sendFile(path.join(root,"portal","index.html")));
app.listen(3101,"127.0.0.1",()=>console.log("Portal UX preview http://localhost:3101"));

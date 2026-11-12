import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

const samples = [
  ["01_text_api", "文本 API"],
  ["02_image_api", "图像 Mock"],
  ["03_video_async_api", "异步视频 Mock"],
  ["04_text_image_video_pipeline", "文本 → 图像 → 视频 Mock"],
  ["05_official_partner_example", "官方 Partner"],
  ["06_provider_switch_demo", "切换文本供应商"],
];
let latestResult = "";
const inFlight = new Map();

async function data(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取 STRGO 数据，请检查登录状态。");
  return response.json();
}

function option(select, value, text, disabled = false) {
  const element = new Option(text, value);
  element.disabled = disabled;
  select.add(element);
}

function dialog(title) {
  const panel = document.createElement("dialog");
  panel.setAttribute("aria-label", title);
  panel.style.cssText = "color:var(--fg-color,#eee);background:var(--comfy-menu-bg,#222);border:1px solid var(--border-color,#555);border-radius:8px;max-width:calc(100vw - 32px);padding:20px";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const close = document.createElement("button");
  close.textContent = "关闭";
  close.onclick = () => panel.close();
  panel.append(heading, close);
  panel.addEventListener("close", () => panel.remove(), { once: true });
  document.body.append(panel);
  return panel;
}

async function selectProvider() {
  const panel = dialog("STRGO 工作流与供应商");
  const picker = document.createElement("select");
  picker.setAttribute("aria-label", "工作流");
  const route = document.createElement("select");
  route.setAttribute("aria-label", "供应商与模型");
  const load = document.createElement("button");
  load.textContent = "载入画布";
  load.disabled = true;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  panel.append(picker, route, load, status);
  panel.showModal();
  try {
    const settings = await data("/strgo/settings");
    for (const [id, label] of samples) {
      option(picker, id, label, id === "05_official_partner_example" && !settings.official);
    }
    for (const choice of settings.text) option(route, choice, choice);
    option(route, "official", "官方 Partner · gpt-4.1-nano", !settings.official);
    const sync = () => { route.hidden = picker.value !== "06_provider_switch_demo"; };
    picker.onchange = sync;
    sync();
    load.disabled = false;
    load.onclick = async () => {
      load.disabled = true;
      try {
        const swap = picker.value === "06_provider_switch_demo";
        const official = swap && route.value === "official";
        const name = official ? "05_official_partner_example" : picker.value;
        const graph = await data("/strgo/workflows/" + name);
        if (swap && !official) graph["1"].inputs.selection = route.value;
        await app.loadApiJson(graph, name + ".json");
        panel.close();
      } catch (error) {
        status.textContent = error.message;
        load.disabled = false;
      }
    };
  } catch (error) {
    status.textContent = error.message;
  }
}

function showResult() {
  const panel = dialog("STRGO 最近结果");
  const content = document.createElement("pre");
  content.style.cssText = "max-width:min(70vw,700px);max-height:60vh;overflow:auto;white-space:pre-wrap";
  content.textContent = latestResult || "尚无本次连接收到的结果。";
  panel.append(content);
  panel.showModal();
}

app.registerExtension({
  name: "STRGO.ApiOnly",
  commands: [
    { id: "STRGO.Workflows", label: "工作流与供应商", function: selectProvider },
    { id: "STRGO.Result", label: "最近结果", function: showResult },
    { id: "STRGO.Logout", label: "退出 STRGO ComfyUI", function: async () => {
      const response = await fetch("/auth/logout", { method: "POST", headers: { "X-STRGO-Request": "logout" } });
      if (response.ok) location.assign("/login/");
    } },
  ],
  menuCommands: [{ path: ["STRGO"], commands: ["STRGO.Workflows", "STRGO.Result", "STRGO.Logout"] }],
  setup() {
    api.addEventListener("executed", ({ detail }) => {
      if (typeof detail?.output?.text?.[0] === "string") latestResult = detail.output.text[0];
    });
    const fetchApi = api.fetchApi.bind(api);
    api.fetchApi = async (path, options) => {
      if (path !== "/prompt" || options?.method !== "POST") return fetchApi(path, options);
      const graph = JSON.parse(options.body).prompt;
      const bytes = new TextEncoder().encode(JSON.stringify(graph));
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).join(",");
      const id = inFlight.get(hash) || crypto.randomUUID();
      if (inFlight.size >= 24 && !inFlight.has(hash)) inFlight.delete(inFlight.keys().next().value);
      inFlight.set(hash, id);
      const headers = new Headers(options.headers);
      headers.set("X-STRGO-Request-ID", id);
      const response = await fetchApi(path, { ...options, headers });
      if (response.status < 500 && response.status !== 409 && inFlight.get(hash) === id) inFlight.delete(hash);
      return response;
    };
  },
});

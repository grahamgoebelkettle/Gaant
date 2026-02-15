/**
 * Supabase storage adapter for Gantt template.
 * Set window.__supabaseConfig = { url: "...", anonKey: "..." } before this script runs,
 * or call window.ganttStorage.init({ url, anonKey }) before using cloud features.
 */
(function () {
  let supabase = null;
  let initConfig = null;
  let projectsListCache = [];
  let boardDataCache = {};
  let authCallback = null;

  function isCloudEnabled() {
    return !!supabase;
  }

  async function getSession() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }

  async function ensureBoardsListLoaded() {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data, error } = await supabase
      .from("boards")
      .select("id, name, created_at")
      .eq("owner_id", session.user.id)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn("Supabase boards list:", error);
      return;
    }
    projectsListCache = (data || []).map((row) => ({
      id: row.id,
      name: row.name || "Untitled project",
      createdAt: new Date(row.created_at).getTime()
    }));
  }

  async function ensureBoardDataLoaded(projectId) {
    if (!supabase || !projectId) return;
    if (boardDataCache[projectId]) return;
    const { data, error } = await supabase
      .from("board_data")
      .select("tasks, settings, view, custom_palettes")
      .eq("board_id", projectId)
      .single();
    if (error) {
      if (error.code !== "PGRST116") console.warn("Supabase board_data:", error);
      boardDataCache[projectId] = {
        tasks: [],
        settings: {},
        view: "default",
        custom_palettes: []
      };
      return;
    }
    boardDataCache[projectId] = {
      tasks: data.tasks || [],
      settings: data.settings || {},
      view: data.view || "default",
      custom_palettes: data.custom_palettes || []
    };
  }

  function loadProjectsList() {
    if (!isCloudEnabled()) return null;
    return projectsListCache;
  }

  function saveProjectsList(list) {
    if (!supabase || !Array.isArray(list)) return;
    projectsListCache = list.slice();
    list.forEach((item) => {
      supabase
        .from("boards")
        .update({ name: item.name || "Untitled project" })
        .eq("id", item.id)
        .then(({ error }) => { if (error) console.warn("Supabase update board name:", error); });
    });
  }

  function loadTasks(projectId) {
    if (!isCloudEnabled() || !projectId) return null;
    const row = boardDataCache[projectId];
    return row ? row.tasks : null;
  }

  function loadSettings(projectId) {
    if (!isCloudEnabled() || !projectId) return null;
    const row = boardDataCache[projectId];
    return row ? row.settings : null;
  }

  function loadView(projectId) {
    if (!isCloudEnabled() || !projectId) return null;
    const row = boardDataCache[projectId];
    return row ? row.view : null;
  }

  function loadCustomPalettes(projectId) {
    if (!isCloudEnabled() || !projectId) return null;
    const row = boardDataCache[projectId];
    return row ? row.custom_palettes : null;
  }

  function ensureBoardDataRow(projectId) {
    if (!boardDataCache[projectId]) {
      boardDataCache[projectId] = {
        tasks: [],
        settings: {},
        view: "default",
        custom_palettes: []
      };
    }
    return boardDataCache[projectId];
  }

  function persistBoardData(projectId) {
    if (!supabase || !projectId) return;
    const row = boardDataCache[projectId];
    if (!row) return;
    supabase
      .from("board_data")
      .upsert({
        board_id: projectId,
        tasks: row.tasks,
        settings: row.settings,
        view: row.view,
        custom_palettes: row.custom_palettes,
        updated_at: new Date().toISOString()
      }, { onConflict: "board_id" })
      .then(({ error }) => { if (error) console.warn("Supabase upsert board_data:", error); });
  }

  function saveTasks(projectId, data) {
    if (!isCloudEnabled() || !projectId) return;
    const row = ensureBoardDataRow(projectId);
    row.tasks = data;
    persistBoardData(projectId);
  }

  function saveSettings(projectId, data) {
    if (!isCloudEnabled() || !projectId) return;
    const row = ensureBoardDataRow(projectId);
    row.settings = data;
    persistBoardData(projectId);
  }

  function saveView(projectId, view) {
    if (!isCloudEnabled() || !projectId) return;
    const row = ensureBoardDataRow(projectId);
    row.view = view;
    persistBoardData(projectId);
  }

  function saveCustomPalettes(projectId, palettes) {
    if (!isCloudEnabled() || !projectId) return;
    const row = ensureBoardDataRow(projectId);
    row.custom_palettes = palettes;
    persistBoardData(projectId);
  }

  async function createBoard(name) {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data: board, error: e1 } = await supabase
      .from("boards")
      .insert({ owner_id: session.user.id, name: name || "Untitled project" })
      .select("id")
      .single();
    if (e1 || !board) {
      console.warn("Supabase create board:", e1);
      return null;
    }
    const id = board.id;
    await supabase.from("board_data").insert({
      board_id: id,
      tasks: [],
      settings: {},
      view: "default",
      custom_palettes: []
    });
    boardDataCache[id] = { tasks: [], settings: {}, view: "default", custom_palettes: [] };
    projectsListCache.push({ id, name: name || "Untitled project", createdAt: Date.now() });
    return id;
  }

  async function duplicateBoard(sourceId, newName) {
    if (!supabase) return null;
    await ensureBoardDataLoaded(sourceId);
    const source = boardDataCache[sourceId];
    const id = await createBoard(newName);
    if (!id || !source) return id;
    boardDataCache[id] = {
      tasks: JSON.parse(JSON.stringify(source.tasks || [])),
      settings: JSON.parse(JSON.stringify(source.settings || {})),
      view: source.view || "default",
      custom_palettes: JSON.parse(JSON.stringify(source.custom_palettes || []))
    };
    persistBoardData(id);
    const idx = projectsListCache.findIndex((p) => p.id === id);
    if (idx >= 0) projectsListCache[idx].name = newName || projectsListCache[idx].name;
    return id;
  }

  async function deleteBoard(projectId) {
    if (!supabase || !projectId) return;
    await supabase.from("boards").delete().eq("id", projectId);
    delete boardDataCache[projectId];
    projectsListCache = projectsListCache.filter((p) => p.id !== projectId);
  }

  async function signIn(email, password) {
    if (!supabase) return { error: new Error("Supabase not configured") };
    var result;
    try {
      result = await supabase.auth.signInWithPassword({ email, password });
    } catch (e) {
      var err = e instanceof Error ? e : new Error(String(e));
      if (typeof console !== "undefined" && console.warn) console.warn("[Supabase auth]", err.message);
      return { error: err };
    }
    var data = result.data;
    var error = result.error;
    if (error) {
      if (typeof console !== "undefined" && console.warn) console.warn("[Supabase auth]", error.message || error);
      return { error: error };
    }
    try {
      await ensureBoardsListLoaded();
    } catch (e) {
      console.warn("Boards list load failed:", e);
    }
    if (authCallback) authCallback(data.session);
    return { session: data.session };
  }

  async function signUp(email, password) {
    if (!supabase) return { error: new Error("Supabase not configured") };
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };
    if (data.session) {
      try {
        await ensureBoardsListLoaded();
      } catch (e) {
        console.warn("Boards list load failed:", e);
      }
      if (authCallback) authCallback(data.session);
    }
    return { session: data.session, error };
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    projectsListCache = [];
    boardDataCache = {};
    if (authCallback) authCallback(null);
  }

  function onAuthChange(cb) {
    authCallback = cb;
    if (supabase && typeof cb === "function") {
      supabase.auth.getSession().then(function (result) {
        const session = result && result.data && result.data.session;
        cb(session);
      });
    }
  }

  async function refreshAuthUI() {
    const session = await getSession();
    if (authCallback) authCallback(session);
  }

  const GANTT_SUPABASE_CONFIG_KEY = "gantt-supabase-config";

  function init(config) {
    if (!config || !config.url || !config.anonKey) return;
    if (config.url.includes("YOUR_PROJECT") || config.anonKey.includes("YOUR_ANON")) return;
    var url = String(config.url).trim();
    var anonKey = String(config.anonKey).trim();
    if (initConfig && supabase && initConfig.url === url && initConfig.anonKey === anonKey) return;
    initConfig = { url: url, anonKey: anonKey };
    if (typeof window.supabase !== "undefined") {
      supabase = window.supabase.createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          if (session) await ensureBoardsListLoaded();
        } else if (event === "SIGNED_OUT") {
          projectsListCache = [];
          boardDataCache = {};
        }
        if (authCallback) authCallback(session);
      });
      supabase.auth.getSession().then(function (result) {
        const session = result && result.data && result.data.session;
        if (authCallback) authCallback(session);
      });
    }
  }

  function getSavedConfig() {
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(GANTT_SUPABASE_CONFIG_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (c && c.url && c.anonKey) return c;
    } catch (e) {}
    return null;
  }

  function saveConfig(config) {
    if (!config || !config.url || !config.anonKey) return { error: new Error("URL and anon key are required") };
    let url = String(config.url).trim();
    const anonKey = String(config.anonKey).trim();
    if (!url || !anonKey) return { error: new Error("URL and anon key are required") };
    if (url.includes("YOUR_PROJECT") || anonKey.includes("YOUR_ANON")) return { error: new Error("Replace placeholders with your Supabase project URL and anon key") };
    if (url.includes("supabase.com/dashboard")) {
      const match = /\/project\/([a-z0-9]+)/i.exec(url);
      if (match) url = "https://" + match[1] + ".supabase.co";
      else return { error: new Error("Use the API URL from Settings → API (e.g. https://xxxxx.supabase.co), not the dashboard page URL.") };
    }
    if (!/^https:\/\/[^.]+\.supabase\.co\/?$/i.test(url)) return { error: new Error("Project URL must be like https://xxxxx.supabase.co (from Supabase Dashboard → Settings → API)") };
    try {
      localStorage.setItem(GANTT_SUPABASE_CONFIG_KEY, JSON.stringify({ url, anonKey }));
      init({ url, anonKey });
      return { ok: true };
    } catch (e) {
      return { error: e && e.message ? e : new Error(String(e)) };
    }
  }

  if (window.__supabaseConfig) init(window.__supabaseConfig);
  else {
    const saved = getSavedConfig();
    if (saved) init(saved);
  }

  window.ganttStorage = {
    init,
    saveConfig,
    getSavedConfig,
    isCloudEnabled,
    getSession,
    ensureBoardsListLoaded,
    ensureBoardDataLoaded,
    loadProjectsList,
    saveProjectsList,
    loadTasks,
    saveTasks,
    loadSettings,
    saveSettings,
    loadView,
    saveView,
    loadCustomPalettes,
    saveCustomPalettes,
    createBoard,
    duplicateBoard,
    deleteBoard,
    signIn,
    signUp,
    signOut,
    onAuthChange,
    refreshAuthUI
  };
})();

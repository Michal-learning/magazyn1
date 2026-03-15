// === SUPABASE BOOTSTRAP ===

window.APP_SUPABASE_CONFIG = {
  url: "https://vprzhxqgotxrmrjslzll.supabase.co",
  key: "sb_publishable_tQQWuI1oZN3VQ814S3eFOg_4Mi25nFD"
};

(function initSupabaseGlobal() {
  const cfg = window.APP_SUPABASE_CONFIG || {};
  const url = String(cfg.url || "").trim();
  const key = String(cfg.key || "").trim();

  if (!url || !key) {
    console.warn("Brak konfiguracji Supabase.");
    window.sb = null;
    window.appAuth = {
      client: null,
      session: null,
      user: null,
      profile: null,
      membership: null,
      companyId: null,
      companyRole: null
    };
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Biblioteka Supabase nie została załadowana.");
    window.sb = null;
    return;
  }

  const client = window.supabase.createClient(url, key);

  window.sb = client;
  window.appAuth = {
    client,
    session: null,
    user: null,
    profile: null,
    membership: null,
    companyId: null,
    companyRole: null
  };
})();

window.refreshAuthContext = async function refreshAuthContext() {
  if (!window.sb) {
    return {
      ok: false,
      reason: "missing_client"
    };
  }

  const { data: sessionData, error: sessionError } = await window.sb.auth.getSession();
  if (sessionError) {
    console.error("Błąd getSession:", sessionError);
    return {
      ok: false,
      reason: "session_error",
      error: sessionError
    };
  }

  const session = sessionData?.session || null;
  const user = session?.user || null;

  window.appAuth.session = session;
  window.appAuth.user = user;
  window.appAuth.profile = null;
  window.appAuth.membership = null;
  window.appAuth.companyId = null;
  window.appAuth.companyRole = null;

  if (!user) {
    return {
      ok: true,
      loggedIn: false
    };
  }

  const { data: profile, error: profileError } = await window.sb
    .from("profiles")
    .select("id, email, full_name, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Błąd pobierania profilu:", profileError);
    return {
      ok: false,
      reason: "profile_error",
      error: profileError
    };
  }

  const { data: membership, error: membershipError } = await window.sb
    .from("company_members")
    .select("id, role, company_id, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("Błąd pobierania company_members:", membershipError);
    return {
      ok: false,
      reason: "membership_error",
      error: membershipError
    };
  }

  window.appAuth.profile = profile || null;
  window.appAuth.membership = membership || null;
  window.appAuth.companyId = membership?.company_id || null;
  window.appAuth.companyRole = membership?.role || null;

  return {
    ok: true,
    loggedIn: true,
    user,
    profile,
    membership
  };
};

window.signInWithPassword = async function signInWithPassword(email, password) {
  if (!window.sb) throw new Error("Brak klienta Supabase.");

  const { data, error } = await window.sb.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw error;

  await window.refreshAuthContext();
  return data;
};

window.signOutApp = async function signOutApp() {
  if (!window.sb) throw new Error("Brak klienta Supabase.");

  const { error } = await window.sb.auth.signOut();
  if (error) throw error;

  await window.refreshAuthContext();
};

window.testSupabaseConnection = async function testSupabaseConnection() {
  const result = await window.refreshAuthContext();
  console.log("SUPABASE TEST RESULT:", result);
  console.log("APP AUTH:", window.appAuth);
  return result;
};

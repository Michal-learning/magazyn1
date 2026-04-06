// === SUPABASE BOOTSTRAP ===

window.APP_SUPABASE_CONFIG = {
  url: "https://vprzhxqgotxrmrjslzll.supabase.co",
  key: "sb_publishable_tQQWuI1oZN3VQ814S3eFOg_4Mi25nFD",
  createUserFunctionName: "create-company-worker",
  createWorkerFunctionName: "create-company-worker"
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
      companyName: null,
      companyRole: null,
      rolePermissions: {}
    };
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Biblioteka Supabase nie została załadowana.");
    window.sb = null;
    return;
  }

  const client = window.supabase.createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  window.sb = client;
  window.appAuth = {
    client,
    session: null,
    user: null,
    profile: null,
    membership: null,
    companyId: null,
    companyName: null,
    companyRole: null,
    rolePermissions: {}
  };
})();

window.__authRefreshInFlight = null;

window.refreshAuthContext = async function refreshAuthContext(sessionOverride) {
  if (window.__authRefreshInFlight) return window.__authRefreshInFlight;

  window.__authRefreshInFlight = (async () => {
    if (!window.sb) {
      return {
        ok: false,
        reason: "missing_client"
      };
    }

    let session = (typeof sessionOverride !== "undefined") ? (sessionOverride || null) : null;

    if (typeof sessionOverride === "undefined") {
      const { data: sessionData, error: sessionError } = await window.sb.auth.getSession();
      if (sessionError) {
        console.error("Błąd getSession:", sessionError);
        return {
          ok: false,
          reason: "session_error",
          error: sessionError
        };
      }
      session = sessionData?.session || null;
    }

    const user = session?.user || null;

    window.appAuth.session = session;
    window.appAuth.user = user;
    window.appAuth.profile = null;
    window.appAuth.membership = null;
    window.appAuth.companyId = null;
    window.appAuth.companyName = null;
    window.appAuth.companyRole = null;
    window.appAuth.rolePermissions = {};

    if (!user) {
      return {
        ok: true,
        loggedIn: false,
        rolePermissions: {}
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
      .select("id, user_id, role, company_id, is_active")
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

    let company = null;
    if (membership?.company_id) {
      const { data: companyData, error: companyError } = await window.sb
        .from("companies")
        .select("id, name")
        .eq("id", membership.company_id)
        .maybeSingle();

      if (companyError) {
        console.error("Błąd pobierania companies:", companyError);
      } else {
        company = companyData || null;
      }
    }

    let rolePermissions = {};
    let rolePermissionsError = null;

    if (membership?.company_id) {
      try {
        const rows = await window.fetchCompanyRolePermissions?.(membership.company_id);
        rolePermissions = Array.isArray(rows)
          ? rows.reduce((acc, row) => {
              const role = String(row?.role || "").trim().toLowerCase();
              if (!role) return acc;
              acc[role] = {
                ...row,
                role
              };
              return acc;
            }, {})
          : {};
      } catch (err) {
        rolePermissionsError = err;
        console.error("Błąd pobierania role permissions w refreshAuthContext:", err);
      }
    }

    window.appAuth.profile = profile || null;
    window.appAuth.membership = membership || null;
    window.appAuth.companyId = membership?.company_id || null;
    window.appAuth.companyName = company?.name || null;
    window.appAuth.companyRole = membership?.role || null;
    window.appAuth.rolePermissions = rolePermissions;

    return {
      ok: true,
      loggedIn: true,
      user,
      profile,
      membership,
      company,
      rolePermissions,
      rolePermissionsLoaded: !rolePermissionsError,
      rolePermissionsError
    };
  })();

  try {
    return await window.__authRefreshInFlight;
  } finally {
    window.__authRefreshInFlight = null;
  }
};

window.signInWithPassword = async function signInWithPassword(email, password) {
  if (!window.sb) throw new Error("Brak klienta Supabase.");

  const { data, error } = await window.sb.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw error;

  return data;
};

window.signOutApp = async function signOutApp() {
  if (!window.sb) throw new Error("Brak klienta Supabase.");

  const { error } = await window.sb.auth.signOut();
  if (error) throw error;
};

window.updateOwnPassword = async function updateOwnPassword(newPassword) {
  if (!window.sb) throw new Error("Brak klienta Supabase.");

  const password = String(newPassword || "");
  if (!password) throw new Error("Nowe hasło nie może być puste.");
  if (password.length < 8) throw new Error("Nowe hasło musi mieć co najmniej 8 znaków.");

  const { data, error } = await window.sb.auth.updateUser({
    password
  });

  if (error) throw error;
  return data;
};

window.fetchCompanyRolePermissions = async function fetchCompanyRolePermissions(companyIdOverride) {
  if (!window.sb) throw new Error("Brak klienta Supabase.");

  const companyId = companyIdOverride || window.appAuth?.companyId;
  if (!companyId) throw new Error("Brak company_id w kontekście użytkownika.");

  const { data, error } = await window.sb
    .from("company_role_permissions")
    .select("id, company_id, role, tab_permissions, created_at, updated_at")
    .eq("company_id", companyId)
    .order("role", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.upsertCompanyRolePermissions = async function upsertCompanyRolePermissions(role, tabPermissions = {}, companyIdOverride) {
  if (!window.sb) throw new Error("Brak klienta Supabase.");

  const companyId = companyIdOverride || window.appAuth?.companyId;
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!companyId) throw new Error("Brak company_id w kontekście użytkownika.");
  if (!["admin", "worker"].includes(normalizedRole)) {
    throw new Error("Na tym etapie można zapisywać konfigurację tylko dla ról admin i worker.");
  }

  const payload = {
    company_id: companyId,
    role: normalizedRole,
    tab_permissions: { ...(tabPermissions || {}) }
  };

  const { data, error } = await window.sb
    .from("company_role_permissions")
    .upsert(payload, { onConflict: "company_id,role" })
    .select("id, company_id, role, tab_permissions, created_at, updated_at")
    .maybeSingle();

  if (error) throw error;
  return data;
};

window.fetchCompanyUsers = async function fetchCompanyUsers(companyIdOverride) {
  if (!window.sb) throw new Error("Brak klienta Supabase.");

  const companyId = companyIdOverride || window.appAuth?.companyId;
  if (!companyId) throw new Error("Brak company_id w kontekście użytkownika.");

  const { data: members, error: membersError } = await window.sb
    .from("company_members")
    .select("id, user_id, role, company_id, is_active")
    .eq("company_id", companyId)
    .order("role", { ascending: true });

  if (membersError) throw membersError;

  const userIds = [...new Set((members || []).map(m => m?.user_id).filter(Boolean))];
  let profilesById = new Map();

  if (userIds.length) {
    const { data: profiles, error: profilesError } = await window.sb
      .from("profiles")
      .select("id, email, full_name, is_active")
      .in("id", userIds);

    if (profilesError) throw profilesError;
    profilesById = new Map((profiles || []).map(p => [p.id, p]));
  }

  return (members || []).map(member => {
    const profile = profilesById.get(member.user_id) || null;
    return {
      id: member.id,
      user_id: member.user_id,
      company_id: member.company_id,
      role: member.role,
      is_active: !!member.is_active,
      email: profile?.email || "—",
      full_name: profile?.full_name || "",
      profile_is_active: profile?.is_active !== false
    };
  }).sort((a, b) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1;
    if (a.role !== 'owner' && b.role === 'owner') return 1;
    return String(a.email || '').localeCompare(String(b.email || ''), 'pl');
  });
};

window.updateCompanyMember = async function updateCompanyMember(memberId, updates = {}) {
  if (!window.sb) throw new Error("Brak klienta Supabase.");
  if (!memberId) throw new Error("Brak id membershipu.");

  const payload = {};
  if (typeof updates.role === 'string' && updates.role.trim()) payload.role = updates.role.trim();
  if (typeof updates.is_active === 'boolean') payload.is_active = updates.is_active;

  if (!Object.keys(payload).length) {
    throw new Error("Brak zmian do zapisania.");
  }

  const { data, error } = await window.sb
    .from('company_members')
    .update(payload)
    .eq('id', memberId)
    .select('id, user_id, role, company_id, is_active')
    .maybeSingle();

  if (error) throw error;
  return data;
};

window.createCompanyUser = async function createCompanyUser(payload = {}) {
  if (!window.sb) throw new Error("Brak klienta Supabase.");

  const email = String(payload?.email || "").trim().toLowerCase();
  const password = String(payload?.password || "");
  const role = String(payload?.role || "worker").trim().toLowerCase() || "worker";
  const companyId = window.appAuth?.companyId || null;

  if (!companyId) throw new Error("Brak company_id w kontekście użytkownika.");
  if (!email) throw new Error("Podaj adres e-mail pracownika.");
  if (!password) throw new Error("Podaj hasło startowe.");
  if (password.length < 6) throw new Error("Hasło startowe musi mieć co najmniej 6 znaków.");
  if (!["worker", "admin"].includes(role)) throw new Error("Na tym etapie można tworzyć tylko konta worker albo admin.");

  const functionName = String(
    window.APP_SUPABASE_CONFIG?.createUserFunctionName
    || window.APP_SUPABASE_CONFIG?.createWorkerFunctionName
    || ""
  ).trim();
  if (!functionName) {
    throw new Error("Brak nazwy Edge Function dla ręcznego tworzenia użytkownika. Skonfiguruj createUserFunctionName.");
  }

  const { data: sessionData, error: sessionError } = await window.sb.auth.getSession();
  if (sessionError) throw sessionError;

  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    throw new Error("Brak aktywnej sesji użytkownika. Zaloguj się ponownie.");
  }

  const supabaseUrl = String(window.APP_SUPABASE_CONFIG?.url || "").trim().replace(/\/$/, "");
  const supabaseKey = String(window.APP_SUPABASE_CONFIG?.key || "").trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Brak konfiguracji Supabase URL lub key.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": supabaseKey,
      "Authorization": `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      email,
      password,
      companyId,
      role
    })
  });

  let result = null;
  try {
    result = await response.json();
  } catch {}

  if (!response.ok) {
    const err = new Error(result?.message || `Edge Function zwróciła błąd HTTP ${response.status}.`);
    err.status = response.status;
    err.payload = result;
    throw err;
  }

  return result || null;
};

window.createCompanyWorker = async function createCompanyWorker(payload = {}) {
  return window.createCompanyUser(payload);
};

window.testSupabaseConnection = async function testSupabaseConnection() {
  const result = await window.refreshAuthContext();
  console.log("SUPABASE TEST RESULT:", result);
  console.log("APP AUTH:", window.appAuth);
  return result;
};

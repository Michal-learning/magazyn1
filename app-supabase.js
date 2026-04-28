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
      companyLowWarn: null,
      companyLowDanger: null,
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
    companyLowWarn: null,
    companyLowDanger: null,
    companyRole: null,
    rolePermissions: {}
  };
})();

window.__authRefreshInFlight = null;

function getRawErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err.trim();
  if (typeof err?.message === 'string') return err.message.trim();
  return '';
}

window.getUserFriendlyErrorMessage = function getUserFriendlyErrorMessage(err, fallbackMessage = 'Operacja nie powiodła się. Spróbuj ponownie.') {
  const rawMessage = getRawErrorMessage(err);
  const fallback = String(fallbackMessage || 'Operacja nie powiodła się. Spróbuj ponownie.').trim();
  const message = rawMessage.toLowerCase();

  if (!rawMessage) return fallback;

  if (message.includes('invalid login credentials')) {
    return 'Nieprawidłowy e-mail lub hasło.';
  }

  if (message.includes('company_id')) {
    return 'Nie udało się ustalić danych firmy. Odśwież aplikację i zaloguj się ponownie.';
  }

  if (message.includes('supplier_id') || message.includes('part_id') || message.includes('mapowania supplier_id') || message.includes('mapowania part_id')) {
    return 'Wybrana część lub dostawca nie są już dostępne. Odśwież dane i spróbuj ponownie.';
  }

  if (message.includes('machinecode') || (message.includes('qty > 0') && message.includes('pozycja produkcji')) || (message.includes('machine_code') && message.includes('qty'))) {
    return 'Każda pozycja produkcji musi mieć wybraną maszynę i ilość większą od zera.';
  }

  if (message.includes('ręczna alokacja') && message.includes('qty > 0')) {
    return 'Każda ręczna alokacja musi wskazywać partię, część i ilość większą od zera.';
  }

  if (message.includes('edge function') || message.includes('http 500') || message.includes('fetch failed') || message.includes('failed to fetch') || message.includes('networkerror') || message.includes('network error')) {
    return 'Operacja nie powiodła się po stronie serwera. Spróbuj ponownie za chwilę.';
  }

  if (message.includes('nie znaleziono dostawcy') || message.includes('brak dostawcy dla dostawy')) {
    return 'Wybrany dostawca nie jest już dostępny. Odśwież dane i wybierz go ponownie.';
  }

  if (message.includes('nie znaleziono części') || message.includes('brak pozycji dostawy do zapisania')) {
    return 'Jedna z wybranych części nie jest już dostępna. Odśwież dane i sprawdź pozycje.';
  }

  if (message.includes('nie udało się potwierdzić aktualnej wersji rekordu') || message.includes('został zmieniony przez innego użytkownika')) {
    return 'Dane zostały zmienione przez innego użytkownika. Odśwież widok i spróbuj ponownie.';
  }

  if (message.includes('brak klienta supabase')) {
    return 'Połączenie z serwerem nie jest gotowe. Odśwież aplikację i spróbuj ponownie.';
  }

  if (message.includes('brak aktywnej sesji')) {
    return 'Sesja wygasła. Zaloguj się ponownie.';
  }

  if (message.includes('brak konfiguracji supabase') || message.includes('brak nazwy edge function')) {
    return 'Aplikacja nie jest jeszcze poprawnie skonfigurowana. Skontaktuj się z administratorem.';
  }

  if (message.includes('membershipu')) {
    return 'Nie udało się ustalić użytkownika do aktualizacji. Odśwież listę i spróbuj ponownie.';
  }

  return rawMessage || fallback;
};

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
    window.appAuth.companyLowWarn = null;
    window.appAuth.companyLowDanger = null;
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
        .select("id, name, low_warn, low_danger")
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
    const companyLowWarn = normalizeBusinessInt(company?.low_warn, 100);
    const companyLowDanger = Math.min(normalizeBusinessInt(company?.low_danger, 50), companyLowWarn);

    window.appAuth.companyId = membership?.company_id || null;
    window.appAuth.companyName = company?.name || null;
    window.appAuth.companyLowWarn = company ? companyLowWarn : null;
    window.appAuth.companyLowDanger = company ? companyLowDanger : null;
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
    .select("id, company_id, role, tab_permissions, feature_permissions, created_at, updated_at")
    .eq("company_id", companyId)
    .order("role", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.upsertCompanyRolePermissions = async function upsertCompanyRolePermissions(role, tabPermissions = {}, featurePermissions = {}, companyIdOverride) {
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
    tab_permissions: { ...(tabPermissions || {}) },
    feature_permissions: { ...(featurePermissions || {}) }
  };

  const { data, error } = await window.sb
    .from("company_role_permissions")
    .upsert(payload, { onConflict: "company_id,role" })
    .select("id, company_id, role, tab_permissions, feature_permissions, created_at, updated_at")
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

  const fullName = String(payload?.fullName || "").trim();
  const email = String(payload?.email || "").trim().toLowerCase();
  const password = String(payload?.password || "");
  const role = String(payload?.role || "worker").trim().toLowerCase() || "worker";
  const companyId = window.appAuth?.companyId || null;

  if (!companyId) throw new Error("Brak company_id w kontekście użytkownika.");
  if (!fullName) throw new Error("Podaj imię i nazwisko pracownika.");
  if (fullName.length > 150) throw new Error("Imię i nazwisko nie może przekraczać 150 znaków.");
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
      fullName,
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

function requireBusinessCompanyId(companyIdOverride) {
  const companyId = companyIdOverride || window.appAuth?.companyId;
  if (!window.sb) throw new Error("Brak klienta Supabase.");
  if (!companyId) throw new Error("Brak company_id w kontekście użytkownika.");
  return companyId;
}


function getCatalogConflictErrorMessage(recordLabel) {
  return `Ten ${recordLabel} został zmieniony przez innego użytkownika. Odśwież dane i spróbuj ponownie.`;
}

function ensureExpectedUpdatedAt(expectedUpdatedAt, recordLabel) {
  const normalized = String(expectedUpdatedAt || '').trim();
  if (!normalized) {
    throw new Error(`Nie udało się potwierdzić aktualnej wersji rekordu (${recordLabel}). Odśwież dane i spróbuj ponownie.`);
  }
  return normalized;
}


function normalizeNullableExpectedUpdatedAt(expectedUpdatedAt) {
  const normalized = String(expectedUpdatedAt || '').trim();
  return normalized || null;
}

function getSupplierIdByNameFromCatalogRows(rows, supplierName) {
  const normalizedName = String(supplierName || '').trim();
  if (!normalizedName) {
    throw new Error('Brakuje nazwy dostawcy do mapowania supplier_id.');
  }

  const row = (Array.isArray(rows) ? rows : []).find(item => String(item?.name || '').trim() === normalizedName);
  if (!row?.id) {
    throw new Error('Wybrany dostawca nie jest już dostępny. Odśwież dane i spróbuj ponownie.');
  }

  return row.id;
}

function getPartIdBySkuFromCatalogRows(rows, sku) {
  const normalizedSku = String(sku || '').trim();
  if (!normalizedSku) {
    throw new Error('Brakuje sku części do mapowania part_id.');
  }

  const row = (Array.isArray(rows) ? rows : []).find(item => String(item?.sku || '').trim().toLowerCase() === normalizedSku.toLowerCase());
  if (!row?.id) {
    throw new Error('Wybrana część nie jest już dostępna. Odśwież dane i spróbuj ponownie.');
  }

  return row.id;
}

window.fetchCatalogParts = async function fetchCatalogParts(companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const { data, error } = await window.sb
    .from("parts")
    .select("id, company_id, sku, name, is_active, warning_qty, critical_qty, updated_at")
    .eq("company_id", companyId)
    .order("sku", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchCatalogSuppliers = async function fetchCatalogSuppliers(companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const { data, error } = await window.sb
    .from("suppliers")
    .select("id, company_id, name, is_active, updated_at")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchSupplierPartPrices = async function fetchSupplierPartPrices() {
  requireBusinessCompanyId();
  const { data, error } = await window.sb
    .from("supplier_part_prices")
    .select("id, supplier_id, part_id, price")
    .order("id", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchMachineDefinitions = async function fetchMachineDefinitions(companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const { data, error } = await window.sb
    .from("machine_definitions")
    .select("id, company_id, code, name, is_active, updated_at")
    .eq("company_id", companyId)
    .order("code", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchMachineBomItems = async function fetchMachineBomItems() {
  requireBusinessCompanyId();
  const { data, error } = await window.sb
    .from("machine_bom_items")
    .select("id, machine_definition_id, part_id, qty")
    .order("id", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchCatalogStateFromSupabase = async function fetchCatalogStateFromSupabase(companyIdOverride) {
  const [partsRows, suppliersRows, priceRows, machineRows, bomRows] = await Promise.all([
    window.fetchCatalogParts(companyIdOverride),
    window.fetchCatalogSuppliers(companyIdOverride),
    window.fetchSupplierPartPrices(),
    window.fetchMachineDefinitions(companyIdOverride),
    window.fetchMachineBomItems()
  ]);

  const partsById = new Map();
  const partsCatalog = new Map();
  (partsRows || []).forEach(row => {
    const sku = String(row?.sku || '').trim();
    const key = sku.toLowerCase();
    const name = String(row?.name || '').trim();
    if (!row?.id || !sku || !name) return;
    partsById.set(row.id, row);
    partsCatalog.set(key, {
      sku,
      name,
      yellowThreshold: Number.isInteger(row?.warning_qty) ? row.warning_qty : (row?.warning_qty == null ? null : Math.max(0, Math.trunc(Number(row.warning_qty) || 0))),
      redThreshold: Number.isInteger(row?.critical_qty) ? row.critical_qty : (row?.critical_qty == null ? null : Math.max(0, Math.trunc(Number(row.critical_qty) || 0))),
      archived: row?.is_active === false,
      _rowId: row?.id ?? null,
      _updatedAt: String(row?.updated_at || '').trim() || null
    });
  });

  const suppliersById = new Map();
  const suppliers = new Map();
  (suppliersRows || []).forEach(row => {
    const name = String(row?.name || '').trim();
    if (!row?.id || !name) return;
    suppliersById.set(row.id, row);
    suppliers.set(name, {
      archived: row?.is_active === false,
      prices: new Map(),
      _rowId: row?.id ?? null,
      _updatedAt: String(row?.updated_at || '').trim() || null
    });
  });

  (priceRows || []).forEach(row => {
    const supplier = suppliersById.get(row?.supplier_id);
    const part = partsById.get(row?.part_id);
    if (!supplier || !part) return;
    const supplierEntry = suppliers.get(String(supplier.name || '').trim());
    const partKey = String(part.sku || '').trim().toLowerCase();
    if (!supplierEntry || !partKey) return;
    supplierEntry.prices.set(partKey, Math.max(0, Number(row?.price) || 0));
  });

  const machineRowsById = new Map();
  const bomByMachineId = new Map();

  (machineRows || []).forEach(row => {
    if (!row?.id) return;
    machineRowsById.set(row.id, row);
    bomByMachineId.set(row.id, []);
  });

  (bomRows || []).forEach(row => {
    const machineId = row?.machine_definition_id;
    const part = partsById.get(row?.part_id);
    if (!machineId || !part || !bomByMachineId.has(machineId)) return;
    bomByMachineId.get(machineId).push({
      sku: String(part.sku || '').trim(),
      qty: Math.max(1, Math.trunc(Number(row?.qty) || 1))
    });
  });

  const machineCatalog = (machineRows || []).map(row => ({
    code: String(row?.code || '').trim(),
    name: String(row?.name || '').trim(),
    archived: row?.is_active === false,
    _rowId: row?.id ?? null,
    _updatedAt: String(row?.updated_at || '').trim() || null,
    bom: Array.isArray(bomByMachineId.get(row.id)) ? bomByMachineId.get(row.id) : []
  })).filter(row => row.code && row.name);

  return {
    partsCatalog,
    suppliers,
    machineCatalog
  };
};

window.saveCatalogPartToSupabase = async function saveCatalogPartToSupabase(payload = {}) {
  const companyId = requireBusinessCompanyId(payload?.companyId);
  const sku = String(payload?.sku || '').trim();
  const name = String(payload?.name || '').trim();
  const originalSku = String(payload?.originalSku || sku).trim();
  const selectedSuppliers = Array.isArray(payload?.selectedSuppliers)
    ? payload.selectedSuppliers.map(x => String(x || '').trim()).filter(Boolean)
    : [];
  const pricesBySupplier = payload?.pricesBySupplier && typeof payload.pricesBySupplier === 'object'
    ? payload.pricesBySupplier
    : {};
  const archived = payload?.archived === true;
  const expectedUpdatedAt = normalizeNullableExpectedUpdatedAt(payload?.expectedUpdatedAt);

  if (!sku || !name) throw new Error('Część musi mieć poprawny identyfikator i nazwę.');

  const supplierRows = await window.fetchCatalogSuppliers(companyId);
  const pSupplierPrices = selectedSuppliers.map(supplierName => ({
    supplier_id: getSupplierIdByNameFromCatalogRows(supplierRows, supplierName),
    price: Math.max(0, Number(pricesBySupplier[supplierName]) || 0)
  }));

  const rpcPayload = {
    p_company_id: companyId,
    p_original_sku: originalSku,
    p_sku: sku,
    p_name: name,
    p_is_active: !archived,
    p_warning_qty: payload?.yellowThreshold == null ? null : Math.max(0, Math.trunc(Number(payload.yellowThreshold) || 0)),
    p_critical_qty: payload?.redThreshold == null ? null : Math.max(0, Math.trunc(Number(payload.redThreshold) || 0)),
    p_expected_updated_at: expectedUpdatedAt,
    p_supplier_prices: pSupplierPrices
  };

  const { data, error } = await window.sb.rpc('save_catalog_part', rpcPayload);
  if (error) throw error;

  const savedPart = data?.part || null;
  if (!savedPart || !savedPart.id) {
    throw new Error('Nie udało się zapisać części w Supabase.');
  }

  return savedPart;
};

window.setCatalogPartArchivedInSupabase = async function setCatalogPartArchivedInSupabase(sku, archived, companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const normalizedSku = String(sku || '').trim();
  if (!normalizedSku) throw new Error('Brak sku części.');

  const { data, error } = await window.sb
    .from('parts')
    .update({ is_active: !archived })
    .eq('company_id', companyId)
    .eq('sku', normalizedSku)
    .select('id, sku, is_active')
    .maybeSingle();

  if (error) throw error;
  return data;
};

window.createCatalogSupplierInSupabase = async function createCatalogSupplierInSupabase(name, companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const normalizedName = String(name || '').trim();
  if (!normalizedName) throw new Error('Podaj nazwę dostawcy.');

  const { data, error } = await window.sb
    .from('suppliers')
    .insert({ company_id: companyId, name: normalizedName, is_active: true })
    .select('id, name, is_active')
    .maybeSingle();

  if (error) throw error;
  return data;
};

window.saveSupplierPricesToSupabase = async function saveSupplierPricesToSupabase(payload = {}) {
  const companyId = requireBusinessCompanyId(payload?.companyId);
  const supplierName = String(payload?.supplierName || '').trim();
  const pricesBySku = payload?.pricesBySku && typeof payload?.pricesBySku === 'object'
    ? payload.pricesBySku
    : {};
  const expectedUpdatedAt = ensureExpectedUpdatedAt(payload?.expectedUpdatedAt, 'dostawca');

  if (!supplierName) throw new Error('Brak nazwy dostawcy.');

  const suppliersRows = await window.fetchCatalogSuppliers(companyId);
  const supplierRow = (suppliersRows || []).find(row => String(row?.name || '').trim() === supplierName);
  if (!supplierRow?.id) throw new Error('Nie znaleziono dostawcy w Supabase.');

  const partsRows = await window.fetchCatalogParts(companyId);
  const pPrices = Object.entries(pricesBySku).map(([sku, price]) => ({
    part_id: getPartIdBySkuFromCatalogRows(partsRows, sku),
    price: Math.max(0, Number(price) || 0)
  }));

  const { data, error } = await window.sb.rpc('save_supplier_prices', {
    p_company_id: companyId,
    p_supplier_name: supplierName,
    p_expected_updated_at: expectedUpdatedAt,
    p_prices: pPrices
  });

  if (error) throw error;

  const savedSupplier = data?.supplier || null;
  if (!savedSupplier || !savedSupplier.id) {
    throw new Error('Nie udało się zapisać cennika dostawcy w Supabase.');
  }

  return savedSupplier;
};

window.setCatalogSupplierArchivedInSupabase = async function setCatalogSupplierArchivedInSupabase(name, archived, companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const normalizedName = String(name || '').trim();
  if (!normalizedName) throw new Error('Brak nazwy dostawcy.');

  const { data, error } = await window.sb
    .from('suppliers')
    .update({ is_active: !archived })
    .eq('company_id', companyId)
    .eq('name', normalizedName)
    .select('id, name, is_active')
    .maybeSingle();

  if (error) throw error;
  return data;
};

window.saveMachineDefinitionToSupabase = async function saveMachineDefinitionToSupabase(payload = {}) {
  const companyId = requireBusinessCompanyId(payload?.companyId);
  const code = String(payload?.code || '').trim();
  const name = String(payload?.name || '').trim();
  const originalCode = String(payload?.originalCode || code).trim();
  const archived = payload?.archived === true;
  const expectedUpdatedAt = normalizeNullableExpectedUpdatedAt(payload?.expectedUpdatedAt);
  const bom = Array.isArray(payload?.bom) ? payload.bom : [];

  if (!code || !name) throw new Error('Maszyna musi mieć kod i nazwę.');

  const partsRows = await window.fetchCatalogParts(companyId);
  const pBom = bom.map(item => ({
    part_id: getPartIdBySkuFromCatalogRows(partsRows, item?.sku),
    qty: Math.max(1, Math.trunc(Number(item?.qty) || 1))
  }));

  const rpcPayload = {
    p_company_id: companyId,
    p_original_code: originalCode,
    p_code: code,
    p_name: name,
    p_is_active: !archived,
    p_expected_updated_at: expectedUpdatedAt,
    p_bom: pBom
  };

  const { data, error } = await window.sb.rpc('save_machine_definition', rpcPayload);
  if (error) throw error;

  const savedMachine = data?.machine || null;
  if (!savedMachine || !savedMachine.id) {
    throw new Error('Nie udało się zapisać definicji maszyny.');
  }

  return savedMachine;
};

window.setMachineArchivedInSupabase = async function setMachineArchivedInSupabase(code, archived, companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) throw new Error('Brak kodu maszyny.');

  const { data, error } = await window.sb
    .from('machine_definitions')
    .update({ is_active: !archived })
    .eq('company_id', companyId)
    .eq('code', normalizedCode)
    .select('id, code, is_active')
    .maybeSingle();

  if (error) throw error;
  return data;
};



function normalizeBusinessNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBusinessInt(value, fallback = 0) {
  return Math.max(0, Math.trunc(normalizeBusinessNumber(value, fallback)));
}

window.saveCompanyThresholdsToSupabase = async function saveCompanyThresholdsToSupabase(lowWarn, lowDanger, companyIdOverride) {
  const companyId = companyIdOverride || window.appAuth?.companyId;
  if (!window.sb) throw new Error("Brak klienta Supabase.");
  if (!companyId) throw new Error("Brak company_id w kontekście użytkownika.");

  const normalizedLowWarn = normalizeBusinessInt(lowWarn, 100);
  const normalizedLowDanger = normalizeBusinessInt(lowDanger, 50);
  const safeLowWarn = Math.max(0, normalizedLowWarn);
  const safeLowDanger = Math.min(Math.max(0, normalizedLowDanger), safeLowWarn);

  const { data, error } = await window.sb
    .from('companies')
    .update({
      low_warn: safeLowWarn,
      low_danger: safeLowDanger
    })
    .eq('id', companyId)
    .select('id, name, low_warn, low_danger')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Nie udało się zapisać progów firmy.');

  return {
    ...data,
    low_warn: normalizeBusinessInt(data.low_warn, safeLowWarn),
    low_danger: Math.min(normalizeBusinessInt(data.low_danger, safeLowDanger), normalizeBusinessInt(data.low_warn, safeLowWarn))
  };
};

const INVENTORY_LOT_DB_FIELDS = Object.freeze({
  initialQty: 'qty_initial',
  remainingQty: 'qty_remaining',
  receivedAt: 'received_at'
});

const HISTORY_EVENT_DB_TYPE_BY_LOCAL = Object.freeze({
  delivery: 'delivery_finalized',
  build: 'production_finalized',
  adjustment: 'stock_adjustment'
});

const HISTORY_EVENT_LOCAL_TYPE_BY_DB = Object.freeze({
  delivery_finalized: 'delivery',
  production_finalized: 'build',
  stock_adjustment: 'adjustment'
});

function getInventoryLotReceivedDateISO(row = {}, fallback = '') {
  const raw = String(row?.[INVENTORY_LOT_DB_FIELDS.receivedAt] || row?.created_at || fallback || '').trim();
  return raw ? raw.slice(0, 10) : '';
}

function getHistoryEventDateISO(row = {}, payload = {}) {
  const raw = String(payload?.dateISO || row?.created_at || '').trim();
  return raw ? raw.slice(0, 10) : '';
}

function mapDbEventTypeToLocal(dbTypeRaw) {
  const dbType = String(dbTypeRaw || '').trim().toLowerCase();
  return HISTORY_EVENT_LOCAL_TYPE_BY_DB[dbType] || null;
}

function mapLocalEventTypeToDb(localTypeRaw) {
  const localType = String(localTypeRaw || '').trim().toLowerCase();
  return HISTORY_EVENT_DB_TYPE_BY_LOCAL[localType] || null;
}

function mapUiHistoryLotToDb(lot = {}) {
  return {
    lot_id: lot?.lotId == null ? null : String(lot.lotId),
    qty: normalizeBusinessInt(lot?.qty, 0),
    removed_qty: normalizeBusinessInt(lot?.removedQty, 0),
    remaining_after: normalizeBusinessInt(lot?.remainingAfter, 0),
    sku: String(lot?.sku || '').trim(),
    name: String(lot?.name || '').trim(),
    supplier: String(lot?.supplier || '').trim() || '-',
    date_in: String(lot?.dateIn || lot?.dateISO || '').trim() || null,
    unit_price: Math.max(0, normalizeBusinessNumber(lot?.unitPrice, 0))
  };
}

function mapDbHistoryLotToUi(lot = {}) {
  const rawDate = String(lot?.date_in || lot?.dateIn || '').trim();
  return {
    lotId: lot?.lot_id == null ? (lot?.lotId == null ? null : String(lot.lotId)) : String(lot.lot_id),
    qty: normalizeBusinessInt(lot?.qty, 0),
    removedQty: normalizeBusinessInt(lot?.removed_qty ?? lot?.removedQty, 0),
    remainingAfter: normalizeBusinessInt(lot?.remaining_after ?? lot?.remainingAfter, 0),
    sku: String(lot?.sku || '').trim(),
    name: String(lot?.name || '').trim(),
    supplier: String(lot?.supplier || '-').trim() || '-',
    dateIn: rawDate ? rawDate.slice(0, 10) : '',
    unitPrice: Math.max(0, normalizeBusinessNumber(lot?.unit_price ?? lot?.unitPrice, 0))
  };
}

function mapUiHistoryEventToDbPayload(historyEvent = {}) {
  const localType = String(historyEvent?.type || '').trim().toLowerCase();
  const dateISO = String(historyEvent?.dateISO || '').trim() || '';

  if (localType === 'delivery') {
    return {
      dateISO,
      supplier: String(historyEvent?.supplier || '').trim() || '-',
      items: (Array.isArray(historyEvent?.items) ? historyEvent.items : []).map(item => ({
        sku: String(item?.sku || '').trim(),
        name: String(item?.name || '').trim(),
        qty: normalizeBusinessInt(item?.qty, 0),
        unit_price: Math.max(0, normalizeBusinessNumber(item?.price ?? item?.unitPrice, 0))
      })).filter(item => item.sku)
    };
  }

  if (localType === 'build') {
    return {
      dateISO,
      items: (Array.isArray(historyEvent?.items) ? historyEvent.items : []).map(item => ({
        code: String(item?.code || '').trim(),
        name: String(item?.name || '').trim(),
        qty: normalizeBusinessInt(item?.qty, 0),
        parts_used: (Array.isArray(item?.partsUsed) ? item.partsUsed : []).map(part => ({
          sku: String(part?.sku || '').trim(),
          name: String(part?.name || '').trim(),
          qty: normalizeBusinessInt(part?.qty, 0),
          lots: (Array.isArray(part?.lots) ? part.lots : []).map(mapUiHistoryLotToDb)
        })).filter(part => part.sku)
      })).filter(item => item.code)
    };
  }

  if (localType === 'adjustment') {
    const items = Array.isArray(historyEvent?.items)
      ? historyEvent.items
      : (Array.isArray(historyEvent?.details?.changes) ? historyEvent.details.changes : []);

    return {
      dateISO,
      parts_changed: normalizeBusinessInt(historyEvent?.partsChanged ?? items.length, items.length),
      items: items.map(item => ({
        sku: String(item?.sku || '').trim(),
        name: String(item?.name || '').trim(),
        previous_qty: normalizeBusinessInt(item?.previousQty, 0),
        new_qty: normalizeBusinessInt(item?.newQty, 0),
        diff: Math.trunc(normalizeBusinessNumber(item?.diff, 0)),
        direction: String(item?.direction || '').trim(),
        reference_unit_price: Math.max(0, normalizeBusinessNumber(item?.referenceUnitPrice, 0)),
        created_lot: item?.createdLot ? mapUiHistoryLotToDb(item.createdLot) : null,
        affected_lots: (Array.isArray(item?.affectedLots) ? item.affectedLots : []).map(mapUiHistoryLotToDb)
      })).filter(item => item.sku)
    };
  }

  return { dateISO };
}

function getHistoryEventTitle(historyEvent = {}) {
  const localType = String(historyEvent?.type || '').trim().toLowerCase();

  if (localType === 'delivery') {
    const supplier = String(historyEvent?.supplier || '').trim() || '—';
    return `Dostawa • ${supplier}`;
  }

  if (localType === 'build') {
    const count = Array.isArray(historyEvent?.items) ? historyEvent.items.length : 0;
    return count > 0 ? `Produkcja • ${count} poz.` : 'Produkcja';
  }

  if (localType === 'adjustment') {
    const count = normalizeBusinessInt(historyEvent?.partsChanged, 0) || (Array.isArray(historyEvent?.items) ? historyEvent.items.length : 0);
    return count > 0 ? `Korekta stanów • ${count} cz.` : 'Korekta stanów';
  }

  return 'Historia operacji';
}

function getHistoryEventDescription(historyEvent = {}) {
  const localType = String(historyEvent?.type || '').trim().toLowerCase();
  const dateISO = String(historyEvent?.dateISO || '').trim();

  if (localType === 'delivery') {
    const items = Array.isArray(historyEvent?.items) ? historyEvent.items : [];
    return `Przyjęto ${items.length} pozycji${dateISO ? ` • ${dateISO}` : ''}`;
  }

  if (localType === 'build') {
    const items = Array.isArray(historyEvent?.items) ? historyEvent.items : [];
    const totalQty = items.reduce((sum, item) => sum + normalizeBusinessInt(item?.qty, 0), 0);
    return `Wyprodukowano ${totalQty} szt.${dateISO ? ` • ${dateISO}` : ''}`;
  }

  if (localType === 'adjustment') {
    const items = Array.isArray(historyEvent?.items)
      ? historyEvent.items
      : (Array.isArray(historyEvent?.details?.changes) ? historyEvent.details.changes : []);
    const netDiff = items.reduce((sum, item) => sum + Math.trunc(normalizeBusinessNumber(item?.diff, 0)), 0);
    const netLabel = netDiff > 0 ? `+${netDiff}` : String(netDiff);
    return `Bilans korekty: ${netLabel}${dateISO ? ` • ${dateISO}` : ''}`;
  }

  return dateISO || '';
}

function mapDbHistoryRowToUi(row = {}, author = null) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const localType = mapDbEventTypeToLocal(row?.event_type);
  const dateISO = getHistoryEventDateISO(row, payload);
  const ts = Date.parse(String(row?.created_at || '').trim()) || Date.now();
  const authorFullName = String(author?.full_name || '').trim();
  const authorEmail = String(author?.email || '').trim();
  const authorName = authorFullName || authorEmail || '—';
  const authorUserId = row?.created_by || null;

  if (localType === 'delivery') {
    return {
      id: row?.id,
      ts,
      type: 'delivery',
      authorName,
      authorEmail: authorEmail || null,
      authorUserId,
      dateISO,
      supplier: String(payload?.supplier || '-').trim() || '-',
      invoiceNumber: String((payload?.invoice_number ?? payload?.invoiceNumber ?? '')).trim() || null,
      items: (Array.isArray(payload?.items) ? payload.items : []).map(item => ({
        sku: String(item?.sku || '').trim(),
        name: String(item?.name || '').trim(),
        qty: normalizeBusinessInt(item?.qty, 0),
        price: Math.max(0, normalizeBusinessNumber(item?.unit_price ?? item?.price ?? item?.unitPrice, 0))
      })).filter(item => item.sku)
    };
  }

  if (localType === 'build') {
    return {
      id: row?.id,
      ts,
      type: 'build',
      authorName,
      authorEmail: authorEmail || null,
      authorUserId,
      dateISO,
      items: (Array.isArray(payload?.items) ? payload.items : []).map(item => ({
        code: String(item?.code || '').trim(),
        name: String(item?.name || '').trim(),
        qty: normalizeBusinessInt(item?.qty, 0),
        partsUsed: (Array.isArray(item?.parts_used) ? item.parts_used : Array.isArray(item?.partsUsed) ? item.partsUsed : []).map(part => ({
          sku: String(part?.sku || '').trim(),
          name: String(part?.name || '').trim(),
          qty: normalizeBusinessInt(part?.qty, 0),
          lots: (Array.isArray(part?.lots) ? part.lots : []).map(mapDbHistoryLotToUi)
        })).filter(part => part.sku)
      })).filter(item => item.code)
    };
  }

  if (localType === 'adjustment') {
    const items = Array.isArray(payload?.items)
      ? payload.items
      : (Array.isArray(payload?.details?.changes) ? payload.details.changes : []);

    return {
      id: row?.id,
      ts,
      type: 'adjustment',
      authorName,
      authorEmail: authorEmail || null,
      authorUserId,
      dateISO,
      partsChanged: normalizeBusinessInt(payload?.parts_changed ?? payload?.partsChanged ?? items.length, items.length),
      items: items.map(item => ({
        sku: String(item?.sku || '').trim(),
        name: String(item?.name || '').trim(),
        previousQty: normalizeBusinessInt(item?.previous_qty ?? item?.previousQty, 0),
        newQty: normalizeBusinessInt(item?.new_qty ?? item?.newQty, 0),
        diff: Math.trunc(normalizeBusinessNumber(item?.diff, 0)),
        direction: String(item?.direction || '').trim(),
        referenceUnitPrice: Math.max(0, normalizeBusinessNumber(item?.reference_unit_price ?? item?.referenceUnitPrice, 0)),
        createdLot: item?.created_lot ? mapDbHistoryLotToUi(item.created_lot) : (item?.createdLot ? mapDbHistoryLotToUi(item.createdLot) : null),
        affectedLots: (Array.isArray(item?.affected_lots) ? item.affected_lots : Array.isArray(item?.affectedLots) ? item.affectedLots : []).map(mapDbHistoryLotToUi)
      })).filter(item => item.sku)
    };
  }

  return null;
}

async function buildBusinessLookups(companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const [partsRows, suppliersRows, machineRows] = await Promise.all([
    window.fetchCatalogParts(companyId),
    window.fetchCatalogSuppliers(companyId),
    window.fetchMachineDefinitions(companyId)
  ]);

  return {
    companyId,
    partsById: new Map((partsRows || []).map(row => [row?.id, row]).filter(entry => entry[0])),
    partsBySku: new Map((partsRows || []).map(row => [String(row?.sku || '').trim().toLowerCase(), row]).filter(entry => entry[0] && entry[1])),
    suppliersById: new Map((suppliersRows || []).map(row => [row?.id, row]).filter(entry => entry[0])),
    suppliersByName: new Map((suppliersRows || []).map(row => [String(row?.name || '').trim(), row]).filter(entry => entry[0] && entry[1])),
    machinesById: new Map((machineRows || []).map(row => [row?.id, row]).filter(entry => entry[0])),
    machinesByCode: new Map((machineRows || []).map(row => [String(row?.code || '').trim(), row]).filter(entry => entry[0] && entry[1]))
  };
}

window.fetchInventoryLotsRows = async function fetchInventoryLotsRows(companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const { data, error } = await window.sb
    .from('inventory_lots')
    .select('id, company_id, part_id, supplier_id, unit_price, qty_initial, qty_remaining, received_at, created_at')
    .eq('company_id', companyId)
    .order('received_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchMachineStockRows = async function fetchMachineStockRows(companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const { data, error } = await window.sb
    .from('machine_stock')
    .select('id, company_id, machine_definition_id, qty, created_at')
    .eq('company_id', companyId)
    .order('id', { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchHistoryEventRows = async function fetchHistoryEventRows(companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const { data, error } = await window.sb
    .from('history_events')
    .select('id, company_id, event_type, title, description, payload, created_at, created_by')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchProfilesByIds = async function fetchProfilesByIds(userIds = []) {
  requireBusinessCompanyId();

  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return [];

  const { data, error } = await window.sb
    .from('profiles')
    .select('id, email, full_name')
    .in('id', ids);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchOperationalStateFromSupabase = async function fetchOperationalStateFromSupabase(companyIdOverride) {
  const lookups = await buildBusinessLookups(companyIdOverride);
  const [lotRows, machineStockRows, historyRows] = await Promise.all([
    window.fetchInventoryLotsRows(lookups.companyId),
    window.fetchMachineStockRows(lookups.companyId),
    window.fetchHistoryEventRows(lookups.companyId)
  ]);

  const authorIds = [...new Set((historyRows || []).map(row => String(row?.created_by || '').trim()).filter(Boolean))];
  const authorProfiles = authorIds.length ? await window.fetchProfilesByIds(authorIds) : [];
  const authorProfilesById = new Map((authorProfiles || []).map(profile => [profile?.id, profile]).filter(entry => entry[0]));

  const lots = (lotRows || []).map(row => {
    const part = lookups.partsById.get(row?.part_id) || null;
    const supplier = lookups.suppliersById.get(row?.supplier_id) || null;
    const sku = String(part?.sku || row?.sku || '').trim();
    const name = String(part?.name || row?.name || '').trim();
    if (!sku || !name) return null;
    return {
      id: row?.id,
      sku,
      name,
      supplier: String(supplier?.name || row?.supplier_name || row?.supplier || '-').trim() || '-',
      unitPrice: Math.max(0, normalizeBusinessNumber(row?.unit_price ?? row?.price ?? row?.unitPrice, 0)),
      qty: normalizeBusinessInt(row?.qty_remaining, 0),
      qtyInitial: normalizeBusinessInt(row?.qty_initial, 0),
      dateIn: getInventoryLotReceivedDateISO(row)
    };
  }).filter(Boolean);

  const machinesStock = (machineStockRows || []).map(row => {
    const machine = lookups.machinesById.get(row?.machine_definition_id) || null;
    const code = String(machine?.code || row?.code || '').trim();
    const name = String(machine?.name || row?.name || '').trim();
    if (!code) return null;
    return {
      code,
      name: name || code,
      qty: normalizeBusinessInt(row?.qty, 0),
      _rowId: row?.id ?? null,
      _machineDefinitionId: row?.machine_definition_id ?? null
    };
  }).filter(Boolean);

  const history = (historyRows || []).map(row => mapDbHistoryRowToUi(row, authorProfilesById.get(row?.created_by) || null)).filter(Boolean);

  return { lots, machinesStock, history };
};




window.saveDeliveryToSupabase = async function saveDeliveryToSupabase(payload = {}) {
  const lookups = await buildBusinessLookups(payload?.companyId);
  const supplierName = String(payload?.supplier || '').trim();
  const supplier = supplierName ? lookups.suppliersByName.get(supplierName) || null : null;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const dateISO = String(payload?.dateISO || '').trim();
  const invoiceNumber = String(payload?.invoiceNumber || '').trim();
  const receivedAt = dateISO ? `${dateISO}T00:00:00Z` : null;

  if (!supplierName) throw new Error('Brak dostawcy dla dostawy.');
  if (!supplier?.id) throw new Error(`Nie znaleziono dostawcy "${supplierName}" w Supabase.`);
  if (!items.length) throw new Error('Brak pozycji dostawy do zapisania.');
  if (!receivedAt) throw new Error('Brak daty dostawy.');
  if (!invoiceNumber) throw new Error('Brak numeru faktury dla dostawy.');

  const rpcItems = items.map(item => {
    const sku = String(item?.sku || '').trim().toLowerCase();
    const part = lookups.partsBySku.get(sku);
    const qty = normalizeBusinessInt(item?.qty, 0);
    if (!part?.id) throw new Error(`Nie znaleziono części ${item?.sku || '—'} w Supabase.`);
    return {
      part_id: part.id,
      qty,
      unit_price: Math.max(0, normalizeBusinessNumber(item?.price, 0))
    };
  });

  const { data, error } = await window.sb.rpc('finalize_delivery', {
    p_company_id: lookups.companyId,
    p_supplier_id: supplier.id,
    p_received_at: receivedAt,
    p_items: rpcItems,
    p_invoice_number: invoiceNumber
  });

  if (error) throw error;
  return data;
};

window.saveBuildToSupabase = async function saveBuildToSupabase(payload = {}) {
  const companyId = requireBusinessCompanyId(payload?.companyId);
  const buildISO = String(payload?.buildISO || '').trim();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const manualAllocations = payload?.manualAllocations == null
    ? null
    : (Array.isArray(payload.manualAllocations) ? payload.manualAllocations : []);
  const buildAt = buildISO ? `${buildISO}T00:00:00Z` : null;

  if (!buildAt) throw new Error('Brak daty produkcji.');
  if (!items.length) throw new Error('Brak pozycji produkcji do zapisania.');

  const rpcItems = items.map(item => ({
    machine_code: String(item?.machineCode || '').trim(),
    qty: normalizeBusinessInt(item?.qty, 0)
  }));

  const invalidItem = rpcItems.find(item => !item.machine_code || item.qty <= 0);
  if (invalidItem) throw new Error('Każda pozycja produkcji musi mieć wybraną maszynę i ilość większą od zera.');

  const rpcManualAllocations = manualAllocations === null
    ? null
    : manualAllocations.map(item => ({
        lot_id: String(item?.lotId || '').trim(),
        sku: String(item?.sku || '').trim(),
        qty: normalizeBusinessInt(item?.qty, 0)
      }));

  const invalidManualAllocation = Array.isArray(rpcManualAllocations)
    ? rpcManualAllocations.find(item => !item.lot_id || !item.sku || item.qty <= 0)
    : null;
  if (invalidManualAllocation) {
    throw new Error('Każda ręczna alokacja musi wskazywać partię, część i ilość większą od zera.');
  }

  const { data, error } = await window.sb.rpc('finalize_production', {
    p_company_id: companyId,
    p_build_date: buildAt,
    p_items: rpcItems,
    p_manual_allocations: rpcManualAllocations
  });

  if (error) throw error;
  return data;
};


window.saveStockAdjustmentToSupabase = async function saveStockAdjustmentToSupabase(payload = {}) {
  const companyId = requireBusinessCompanyId(payload?.companyId);
  const dateISO = String(payload?.dateISO || '').trim();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const adjustmentAt = dateISO ? `${dateISO}T00:00:00Z` : null;

  if (!adjustmentAt) throw new Error('Brak daty korekty stanów.');
  if (!items.length) throw new Error('Brak pozycji korekty stanów do zapisania.');

  const rpcItems = items.map(item => ({
    sku: String(item?.sku || '').trim(),
    previous_qty: normalizeBusinessInt(item?.previousQty, 0),
    new_qty: normalizeBusinessInt(item?.newQty, 0),
    reference_unit_price: Math.max(0, normalizeBusinessNumber(item?.referenceUnitPrice, 0))
  }));

  const invalidItem = rpcItems.find(item => !item.sku);
  if (invalidItem) throw new Error('Każda pozycja korekty musi mieć sku.');

  const { data, error } = await window.sb.rpc('apply_stock_adjustment', {
    p_company_id: companyId,
    p_date: adjustmentAt,
    p_items: rpcItems
  });

  if (error) throw error;
  return data;
};

window.testSupabaseConnection = async function testSupabaseConnection() {
  const result = await window.refreshAuthContext();
  console.log("SUPABASE TEST RESULT:", result);
  console.log("APP AUTH:", window.appAuth);
  return result;
};

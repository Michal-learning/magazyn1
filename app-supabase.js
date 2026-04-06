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

function requireBusinessCompanyId(companyIdOverride) {
  const companyId = companyIdOverride || window.appAuth?.companyId;
  if (!window.sb) throw new Error("Brak klienta Supabase.");
  if (!companyId) throw new Error("Brak company_id w kontekście użytkownika.");
  return companyId;
}

window.fetchCatalogParts = async function fetchCatalogParts(companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const { data, error } = await window.sb
    .from("parts")
    .select("id, company_id, sku, name, is_active, warning_qty, critical_qty")
    .eq("company_id", companyId)
    .order("sku", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.fetchCatalogSuppliers = async function fetchCatalogSuppliers(companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const { data, error } = await window.sb
    .from("suppliers")
    .select("id, company_id, name, is_active")
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
    .select("id, company_id, code, name, is_active")
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
      archived: row?.is_active === false
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
      prices: new Map()
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
  const selectedSuppliers = Array.isArray(payload?.selectedSuppliers) ? payload.selectedSuppliers.map(x => String(x || '').trim()).filter(Boolean) : [];
  const pricesBySupplier = payload?.pricesBySupplier && typeof payload.pricesBySupplier === 'object' ? payload.pricesBySupplier : {};
  const archived = payload?.archived === true;

  if (!sku || !name) throw new Error('Część musi mieć sku i name.');

  const { data: currentPart, error: currentPartError } = await window.sb
    .from('parts')
    .select('id, sku')
    .eq('company_id', companyId)
    .eq('sku', originalSku)
    .maybeSingle();
  if (currentPartError) throw currentPartError;

  if (originalSku !== sku) {
    const { data: duplicatePart, error: duplicatePartError } = await window.sb
      .from('parts')
      .select('id')
      .eq('company_id', companyId)
      .eq('sku', sku)
      .maybeSingle();
    if (duplicatePartError) throw duplicatePartError;
    if (duplicatePart && duplicatePart.id !== currentPart?.id) {
      throw new Error(`Część o ID "${sku}" już istnieje w bazie.`);
    }
  }

  let savedPart = currentPart || null;
  const partPayload = {
    company_id: companyId,
    sku,
    name,
    is_active: !archived,
    warning_qty: payload?.yellowThreshold == null ? null : Math.max(0, Math.trunc(Number(payload.yellowThreshold) || 0)),
    critical_qty: payload?.redThreshold == null ? null : Math.max(0, Math.trunc(Number(payload.redThreshold) || 0))
  };

  if (savedPart?.id) {
    const { data, error } = await window.sb
      .from('parts')
      .update(partPayload)
      .eq('id', savedPart.id)
      .select('id, sku')
      .maybeSingle();
    if (error) throw error;
    savedPart = data || { ...savedPart, sku };
  } else {
    const { data, error } = await window.sb
      .from('parts')
      .insert(partPayload)
      .select('id, sku')
      .maybeSingle();
    if (error) throw error;
    savedPart = data;
  }

  if (!savedPart?.id) throw new Error('Nie udało się zapisać części w Supabase.');

  const supplierRows = await window.fetchCatalogSuppliers(companyId);
  const supplierIdsByName = new Map((supplierRows || []).map(row => [String(row?.name || '').trim(), row?.id]).filter(entry => entry[0] && entry[1]));

  const { error: deletePricesError } = await window.sb
    .from('supplier_part_prices')
    .delete()
    .eq('part_id', savedPart.id);
  if (deletePricesError) throw deletePricesError;

  const pricePayload = selectedSuppliers
    .map(nameKey => {
      const supplierId = supplierIdsByName.get(nameKey);
      if (!supplierId) return null;
      return {
        company_id: companyId,
        supplier_id: supplierId,
        part_id: savedPart.id,
        price: Math.max(0, Number(pricesBySupplier[nameKey]) || 0)
      };
    })
    .filter(Boolean);

  if (pricePayload.length) {
    const { error: insertPricesError } = await window.sb
      .from('supplier_part_prices')
      .insert(pricePayload);
    if (insertPricesError) throw insertPricesError;
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
  const pricesBySku = payload?.pricesBySku && typeof payload.pricesBySku === 'object' ? payload.pricesBySku : {};
  if (!supplierName) throw new Error('Brak nazwy dostawcy.');

  const suppliersRows = await window.fetchCatalogSuppliers(companyId);
  const supplierRow = (suppliersRows || []).find(row => String(row?.name || '').trim() === supplierName);
  if (!supplierRow?.id) throw new Error('Nie znaleziono dostawcy w Supabase.');

  const partsRows = await window.fetchCatalogParts(companyId);
  const partIdsBySku = new Map((partsRows || []).map(row => [String(row?.sku || '').trim().toLowerCase(), row?.id]).filter(entry => entry[0] && entry[1]));

  const { error: deletePricesError } = await window.sb
    .from('supplier_part_prices')
    .delete()
    .eq('supplier_id', supplierRow.id);
  if (deletePricesError) throw deletePricesError;

  const insertPayload = Object.entries(pricesBySku)
    .map(([sku, price]) => {
      const partId = partIdsBySku.get(String(sku || '').trim().toLowerCase());
      if (!partId) return null;
      return {
        company_id: companyId,
        supplier_id: supplierRow.id,
        part_id: partId,
        price: Math.max(0, Number(price) || 0)
      };
    })
    .filter(Boolean);

  if (insertPayload.length) {
    const { error: insertPricesError } = await window.sb
      .from('supplier_part_prices')
      .insert(insertPayload);
    if (insertPricesError) throw insertPricesError;
  }

  return supplierRow;
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
  const bom = Array.isArray(payload?.bom) ? payload.bom : [];
  if (!code || !name) throw new Error('Maszyna musi mieć code i name.');

  const { data: currentMachine, error: currentMachineError } = await window.sb
    .from('machine_definitions')
    .select('id, code')
    .eq('company_id', companyId)
    .eq('code', originalCode)
    .maybeSingle();
  if (currentMachineError) throw currentMachineError;

  if (originalCode !== code) {
    const { data: duplicateMachine, error: duplicateMachineError } = await window.sb
      .from('machine_definitions')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', code)
      .maybeSingle();
    if (duplicateMachineError) throw duplicateMachineError;
    if (duplicateMachine && duplicateMachine.id !== currentMachine?.id) {
      throw new Error(`Maszyna o kodzie "${code}" już istnieje w bazie.`);
    }
  }

  let savedMachine = currentMachine || null;
  const machinePayload = {
    company_id: companyId,
    code,
    name,
    is_active: !archived
  };

  if (savedMachine?.id) {
    const { data, error } = await window.sb
      .from('machine_definitions')
      .update(machinePayload)
      .eq('id', savedMachine.id)
      .select('id, code')
      .maybeSingle();
    if (error) throw error;
    savedMachine = data || { ...savedMachine, code };
  } else {
    const { data, error } = await window.sb
      .from('machine_definitions')
      .insert(machinePayload)
      .select('id, code')
      .maybeSingle();
    if (error) throw error;
    savedMachine = data;
  }

  if (!savedMachine?.id) throw new Error('Nie udało się zapisać definicji maszyny.');

  const partsRows = await window.fetchCatalogParts(companyId);
  const partIdsBySku = new Map((partsRows || []).map(row => [String(row?.sku || '').trim().toLowerCase(), row?.id]).filter(entry => entry[0] && entry[1]));

  const { error: deleteBomError } = await window.sb
    .from('machine_bom_items')
    .delete()
    .eq('machine_definition_id', savedMachine.id);
  if (deleteBomError) throw deleteBomError;

  const bomPayload = bom.map(item => {
    const sku = String(item?.sku || '').trim().toLowerCase();
    const partId = partIdsBySku.get(sku);
    if (!partId) throw new Error(`Nie znaleziono części BOM dla sku "${item?.sku || ''}".`);
    return {
      machine_definition_id: savedMachine.id,
      part_id: partId,
      qty: Math.max(1, Math.trunc(Number(item?.qty) || 1))
    };
  });

  if (bomPayload.length) {
    const { error: insertBomError } = await window.sb
      .from('machine_bom_items')
      .insert(bomPayload);
    if (insertBomError) throw insertBomError;
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

function mapDbHistoryRowToUi(row = {}) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const localType = mapDbEventTypeToLocal(row?.event_type);
  const dateISO = getHistoryEventDateISO(row, payload);
  const ts = Date.parse(String(row?.created_at || '').trim()) || Date.now();

  if (localType === 'delivery') {
    return {
      id: row?.id,
      ts,
      type: 'delivery',
      dateISO,
      supplier: String(payload?.supplier || '-').trim() || '-',
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
    .select('id, company_id, event_type, title, description, payload, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

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

  const history = (historyRows || []).map(mapDbHistoryRowToUi).filter(Boolean);

  return { lots, machinesStock, history };
};

async function persistInventoryLotsSnapshot(nextLots = [], companyIdOverride) {
  const lookups = await buildBusinessLookups(companyIdOverride);
  const currentRows = await window.fetchInventoryLotsRows(lookups.companyId);
  const currentIds = new Set((currentRows || []).map(row => row?.id).filter(id => id != null));
  const currentById = new Map((currentRows || []).map(row => [row?.id, row]).filter(entry => entry[0] != null));
  const nextIds = new Set((nextLots || []).map(lot => lot?.id).filter(id => id != null));

  const toDeleteIds = Array.from(currentIds).filter(id => !nextIds.has(id));
  if (toDeleteIds.length) {
    const { error } = await window.sb
      .from('inventory_lots')
      .delete()
      .in('id', toDeleteIds);
    if (error) throw error;
  }

  for (const lot of (nextLots || [])) {
    const sku = String(lot?.sku || '').trim().toLowerCase();
    const part = lookups.partsBySku.get(sku);
    if (!part?.id) throw new Error(`Nie znaleziono części dla partii ${lot?.sku || '—'}.`);

    const supplierName = String(lot?.supplier || '').trim();
    const supplier = supplierName ? lookups.suppliersByName.get(supplierName) || null : null;
    const existingRow = lot?.id != null ? currentById.get(lot.id) || null : null;
    const remainingQty = normalizeBusinessInt(lot?.qty, 0);
    const initialQty = existingRow
      ? normalizeBusinessInt(existingRow?.qty_initial, remainingQty)
      : remainingQty;
    const receivedAt = String(lot?.dateIn || existingRow?.received_at || '').trim() || null;
    const payload = {
      company_id: lookups.companyId,
      part_id: part.id,
      supplier_id: supplier?.id || null,
      unit_price: Math.max(0, normalizeBusinessNumber(lot?.unitPrice, 0)),
      qty_initial: initialQty,
      qty_remaining: remainingQty,
      received_at: receivedAt
    };

    if (lot?.id != null && currentIds.has(lot.id)) {
      const { error } = await window.sb
        .from('inventory_lots')
        .update(payload)
        .eq('id', lot.id);
      if (error) throw error;
    } else {
      const { error } = await window.sb
        .from('inventory_lots')
        .insert(payload);
      if (error) throw error;
    }
  }
}

async function persistMachineStockSnapshot(nextMachineStock = [], companyIdOverride) {
  const lookups = await buildBusinessLookups(companyIdOverride);
  const currentRows = await window.fetchMachineStockRows(lookups.companyId);
  const currentById = new Map((currentRows || []).map(row => [row?.id, row]).filter(entry => entry[0] != null));
  const currentByMachineId = new Map((currentRows || []).map(row => [row?.machine_definition_id, row]).filter(entry => entry[0] != null));
  const keptIds = new Set();

  for (const item of (nextMachineStock || [])) {
    const code = String(item?.code || '').trim();
    const machine = lookups.machinesByCode.get(code);
    if (!machine?.id) throw new Error(`Nie znaleziono definicji maszyny dla kodu ${code || '—'}.`);

    const payload = {
      company_id: lookups.companyId,
      machine_definition_id: machine.id,
      qty: normalizeBusinessInt(item?.qty, 0)
    };

    const rowId = item?._rowId;
    const existingRow = (rowId != null && currentById.has(rowId))
      ? currentById.get(rowId)
      : currentByMachineId.get(machine.id);

    if (existingRow?.id != null) {
      keptIds.add(existingRow.id);
      const { error } = await window.sb
        .from('machine_stock')
        .update(payload)
        .eq('id', existingRow.id);
      if (error) throw error;
    } else {
      const { error } = await window.sb
        .from('machine_stock')
        .insert(payload);
      if (error) throw error;
    }
  }

  const toDeleteIds = (currentRows || [])
    .map(row => row?.id)
    .filter(id => id != null && !keptIds.has(id) && !(nextMachineStock || []).some(item => item?._rowId === id));

  if (toDeleteIds.length) {
    const { error } = await window.sb
      .from('machine_stock')
      .delete()
      .in('id', toDeleteIds);
    if (error) throw error;
  }
}

async function insertHistoryEventRow(historyEvent = {}, companyIdOverride) {
  const companyId = requireBusinessCompanyId(companyIdOverride);
  const eventType = mapLocalEventTypeToDb(historyEvent?.type);

  if (!eventType) throw new Error('Brak typu eventu historii.');

  const payload = {
    company_id: companyId,
    event_type: eventType,
    title: getHistoryEventTitle(historyEvent),
    description: getHistoryEventDescription(historyEvent),
    payload: mapUiHistoryEventToDbPayload(historyEvent)
  };

  const { data, error } = await window.sb
    .from('history_events')
    .insert(payload)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data;
}

window.saveDeliveryToSupabase = async function saveDeliveryToSupabase(payload = {}) {
  const lookups = await buildBusinessLookups(payload?.companyId);
  const supplierName = String(payload?.supplier || '').trim();
  const supplier = supplierName ? lookups.suppliersByName.get(supplierName) || null : null;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const receivedAt = String(payload?.dateISO || '').trim() || null;

  if (!supplierName) throw new Error('Brak dostawcy dla dostawy.');
  if (!items.length) throw new Error('Brak pozycji dostawy do zapisania.');

  const insertPayload = items.map(item => {
    const sku = String(item?.sku || '').trim().toLowerCase();
    const part = lookups.partsBySku.get(sku);
    const qty = normalizeBusinessInt(item?.qty, 0);
    if (!part?.id) throw new Error(`Nie znaleziono części ${item?.sku || '—'} w Supabase.`);
    return {
      company_id: lookups.companyId,
      part_id: part.id,
      supplier_id: supplier?.id || null,
      unit_price: Math.max(0, normalizeBusinessNumber(item?.price, 0)),
      qty_initial: qty,
      qty_remaining: qty,
      received_at: receivedAt
    };
  });

  const { error } = await window.sb
    .from('inventory_lots')
    .insert(insertPayload);
  if (error) throw error;

  await insertHistoryEventRow({
    type: 'delivery',
    dateISO: String(payload?.dateISO || '').trim(),
    supplier: supplierName,
    items: items.map(item => ({
      sku: String(item?.sku || '').trim(),
      name: String(item?.name || '').trim(),
      qty: normalizeBusinessInt(item?.qty, 0),
      price: Math.max(0, normalizeBusinessNumber(item?.price, 0))
    }))
  }, lookups.companyId);
};

window.saveBuildToSupabase = async function saveBuildToSupabase(payload = {}) {
  const companyId = requireBusinessCompanyId(payload?.companyId);
  await persistInventoryLotsSnapshot(Array.isArray(payload?.nextLots) ? payload.nextLots : [], companyId);
  await persistMachineStockSnapshot(Array.isArray(payload?.nextMachineStock) ? payload.nextMachineStock : [], companyId);
  await insertHistoryEventRow(payload?.historyEvent || {
    type: 'build',
    dateISO: String(payload?.buildISO || '').trim(),
    items: []
  }, companyId);
};

window.saveStockAdjustmentToSupabase = async function saveStockAdjustmentToSupabase(payload = {}) {
  const companyId = requireBusinessCompanyId(payload?.companyId);
  await persistInventoryLotsSnapshot(Array.isArray(payload?.nextLots) ? payload.nextLots : [], companyId);
  await insertHistoryEventRow(payload?.historyEvent || {
    type: 'adjustment',
    dateISO: '',
    items: []
  }, companyId);
};

window.testSupabaseConnection = async function testSupabaseConnection() {
  const result = await window.refreshAuthContext();
  console.log("SUPABASE TEST RESULT:", result);
  console.log("APP AUTH:", window.appAuth);
  return result;
};

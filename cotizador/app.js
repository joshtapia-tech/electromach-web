// ============================================================================
// ELECTROMACH · LÓGICA DE APLICACIÓN (COTIZACIONES, ÓRDENES, CLIENTES, ETC.)
// ============================================================================

(function () {
  "use strict";

  const cfg = window.ELECTROMACH_CONFIG || {};
  const isSupabaseConfigured =
    typeof cfg.SUPABASE_URL === "string" &&
    cfg.SUPABASE_URL.startsWith("https://") &&
    !cfg.SUPABASE_URL.includes("TU-PROYECTO") &&
    typeof cfg.SUPABASE_ANON_KEY === "string" &&
    cfg.SUPABASE_ANON_KEY.length > 20 &&
    !cfg.SUPABASE_ANON_KEY.includes("TU-SUPABASE");

  const supabaseClient = isSupabaseConfigured
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  // Estado global en memoria
  const state = {
    user: null,
    settings: {
      id: 1,
      razon_social: "ELECTROMACH SPA",
      rut: "",
      telefono: "+56 9 0000 0000",
      sitio_web: "electromach.cl",
      correo: "contacto@electromach.cl",
      iva_porcentaje: 19,
      validez_dias: 10,
      proximo_num_cotizacion: 1001,
      proximo_num_orden: 501,
      forma_pago: "Transferencia electrónica / Orden de compra",
      metodos_pago: "Transferencia bancaria\nCorreo comprobante: contacto@electromach.cl",
      terminos_condiciones:
        "• Los precios unitarios son NETOS; el IVA (19%) se calcula sobre el total neto.\n• Cotización válida hasta la fecha de vencimiento indicada.\n• Instalaciones eléctricas certificadas bajo normativa SEC.",
      mensaje_final: "¡GRACIAS POR CONFIAR EN ELECTROMACH!"
    },
    customers: [],
    products: [],
    quotes: [],
    orders: [],
    users: [],
    activeQuoteId: null,
    activeOrderId: null
  };

  // ==================== UTILIDADES DE FORMATO ====================
  function formatCLP(value) {
    const num = Math.round(Number(value) || 0);
    return "$" + num.toLocaleString("es-CL");
  }

  function formatDateCL(isoDate) {
    if (!isoDate) return "";
    const parts = String(isoDate).slice(0, 10).split("-");
    if (parts.length !== 3) return isoDate;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  function addDaysISO(isoDate, days) {
    const base = isoDate ? new Date(isoDate + "T12:00:00") : new Date();
    base.setDate(base.getDate() + (parseInt(days, 10) || 0));
    return base.toISOString().slice(0, 10);
  }

  function todayISO() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function escapeHTML(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add("hidden"), 3000);
  }

  function generateLocalUUID() {
    return "loc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  // ==================== CAPA DE PERSISTENCIA (SUPABASE O LOCAL DEMO) ====================
  const LOCAL_KEY = "electromach_cotizador_demo_v1";

  function loadLocalStore() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(state.settings, parsed.settings || {});
        state.customers = parsed.customers || [];
        state.products = parsed.products || [];
        state.quotes = parsed.quotes || [];
        state.orders = parsed.orders || [];
        state.users = parsed.users || [];
        return;
      }
    } catch (e) {
      console.warn("Error leyendo almacenamiento local:", e);
    }
    // Datos semilla iniciales si es la primera vez en modo local
    state.products = [
      { id: "p1", descripcion: "VISITA TÉCNICA Y DIAGNÓSTICO ELÉCTRICO EN TERRENO", precio_neto: 35000 },
      { id: "p2", descripcion: "TABLERO ELÉCTRICO EMBUTIDO 24 POLOS", precio_neto: 145000 },
      { id: "p3", descripcion: "INTERRUPTOR TERMOMAGNÉTICO 1X16A CURVA C", precio_neto: 8900 },
      { id: "p4", descripcion: "PROTECTOR DIFERENCIAL 2X25A 30MA", precio_neto: 26500 },
      { id: "p5", descripcion: "TRAMITACIÓN Y DECLARACIÓN TE1 ANTE SEC", precio_neto: 120000 },
      { id: "p6", descripcion: "MANO DE OBRA INSTALACIÓN ELÉCTRICA CERTIFICADA", precio_neto: 250000 }
    ];
    saveLocalStore();
  }

  function saveLocalStore() {
    if (isSupabaseConfigured) return;
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({
        settings: state.settings,
        customers: state.customers,
        products: state.products,
        quotes: state.quotes,
        orders: state.orders,
        users: state.users
      })
    );
  }

  // ==================== AUTENTICACIÓN ====================
  async function checkInitialSession() {
    if (!isSupabaseConfigured) {
      document.getElementById("login-config-warning").classList.remove("hidden");
      const savedDemoUser = sessionStorage.getItem("electromach_demo_user");
      if (savedDemoUser) {
        state.user = JSON.parse(savedDemoUser);
        await enterApp();
      }
      return;
    }

    const { data } = await supabaseClient.auth.getSession();
    if (data && data.session && data.session.user) {
      state.user = {
        id: data.session.user.id,
        email: data.session.user.email,
        nombre:
          (data.session.user.user_metadata && data.session.user.user_metadata.nombre) ||
          data.session.user.email.split("@")[0]
      };
      await enterApp();
    }
  }

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errBox = document.getElementById("login-error");
    const btn = document.getElementById("login-submit-btn");

    errBox.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "Ingresando...";

    try {
      if (!isSupabaseConfigured) {
        loadLocalStore();
        const nombre = email.split("@")[0];
        state.user = { id: "demo-user", email, nombre };
        if (!state.users.some((u) => u.correo === email)) {
          state.users.push({
            id: "demo-user",
            nombre,
            correo: email,
            created_at: new Date().toISOString()
          });
          saveLocalStore();
        }
        sessionStorage.setItem("electromach_demo_user", JSON.stringify(state.user));
        await enterApp();
        return;
      }

      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;

      state.user = {
        id: data.user.id,
        email: data.user.email,
        nombre:
          (data.user.user_metadata && data.user.user_metadata.nombre) ||
          data.user.email.split("@")[0]
      };
      await enterApp();
    } catch (err) {
      errBox.textContent = "Credenciales incorrectas o usuario no autorizado.";
      errBox.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Ingresar";
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    if (isSupabaseConfigured) {
      await supabaseClient.auth.signOut();
    } else {
      sessionStorage.removeItem("electromach_demo_user");
    }
    state.user = null;
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("login-view").classList.remove("hidden");
    document.getElementById("login-password").value = "";
  });

  async function enterApp() {
    document.getElementById("login-view").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");
    document.getElementById("current-user-name").textContent = state.user.nombre;

    if (!isSupabaseConfigured) {
      document.getElementById("demo-mode-banner").classList.remove("hidden");
      loadLocalStore();
    } else {
      await loadAllFromSupabase();
    }

    renderAll();
    switchView("quotes");
  }

  async function loadAllFromSupabase() {
    const [setRes, custRes, prodRes, quoteRes, ordRes, profRes] = await Promise.all([
      supabaseClient.from("settings").select("*").eq("id", 1).maybeSingle(),
      supabaseClient.from("customers").select("*").order("nombre", { ascending: true }),
      supabaseClient.from("products").select("*").order("descripcion", { ascending: true }),
      supabaseClient.from("quotes").select("*").order("numero", { ascending: false }),
      supabaseClient.from("technical_orders").select("*").order("numero", { ascending: false }),
      supabaseClient.from("profiles").select("*").order("created_at", { ascending: true })
    ]);

    if (setRes.data) Object.assign(state.settings, setRes.data);
    if (custRes.data) state.customers = custRes.data;
    if (prodRes.data) state.products = prodRes.data;
    if (quoteRes.data) state.quotes = quoteRes.data;
    if (ordRes.data) state.orders = ordRes.data;
    if (profRes.data) state.users = profRes.data;

    // Actualizar nombre mostrado desde perfil si existe
    const me = state.users.find((u) => u.id === state.user.id);
    if (me && me.nombre) {
      state.user.nombre = me.nombre;
      document.getElementById("current-user-name").textContent = me.nombre;
    }
  }

  // ==================== NAVEGACIÓN ENTRE VISTAS ====================
  function switchView(viewName) {
    document.querySelectorAll(".app-view").forEach((el) => el.classList.add("hidden"));
    const target = document.getElementById("view-" + viewName);
    if (target) target.classList.remove("hidden");

    const navMap = {
      quotes: "quotes",
      "quote-form": "quotes",
      "quote-preview": "quotes",
      orders: "orders",
      "order-form": "orders",
      "order-preview": "orders",
      customers: "customers",
      products: "products",
      users: "users",
      settings: "settings"
    };
    const activeTab = navMap[viewName] || "quotes";
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === activeTab);
    });
  }

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const target = el.dataset.nav;
      if (target === "quotes") renderQuotesTable();
      if (target === "orders") renderOrdersTable();
      if (target === "customers") renderCustomersTable();
      if (target === "products") renderProductsTable();
      if (target === "users") renderUsersTable();
      if (target === "settings") fillSettingsForm();
      switchView(target);
    });
  });

  function renderAll() {
    renderQuotesTable();
    renderOrdersTable();
    renderCustomersTable();
    renderProductsTable();
    renderUsersTable();
    fillSettingsForm();
    refreshCustomerDropdowns();
    refreshProductDatalist();
  }

  // ==================== 1. COTIZACIONES (LISTADO) ====================
  function renderQuotesTable() {
    const tbody = document.getElementById("quotes-table-body");
    const q = document.getElementById("quotes-search").value.trim().toLowerCase();
    const st = document.getElementById("quotes-status-filter").value;

    const filtered = state.quotes.filter((item) => {
      const matchText =
        !q ||
        String(item.numero).includes(q) ||
        (item.cliente_nombre || "").toLowerCase().includes(q) ||
        (item.cliente_rut || "").toLowerCase().includes(q);
      const matchStatus = !st || item.estado === st;
      return matchText && matchStatus;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No se encontraron cotizaciones.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map(
        (quote) => `
        <tr>
          <td class="font-bold">${escapeHTML(quote.numero)}</td>
          <td>${formatDateCL(quote.fecha)}</td>
          <td>${escapeHTML(quote.cliente_nombre)}</td>
          <td class="text-right">${formatCLP(quote.total_neto)}</td>
          <td class="text-right font-bold">${formatCLP(quote.total_con_iva)}</td>
          <td>
            <select class="inline-status-select" data-quote-status="${quote.id}">
              ${["Borrador", "Enviada", "Aprobada", "Rechazada"]
                .map((s) => `<option value="${s}" ${quote.estado === s ? "selected" : ""}>${s}</option>`)
                .join("")}
            </select>
          </td>
          <td>
            <div class="action-links">
              <button type="button" class="link-action" data-quote-view="${quote.id}">Ver / PDF</button>
              <button type="button" class="link-action" data-quote-edit="${quote.id}">Editar</button>
              <button type="button" class="link-action" data-quote-dup="${quote.id}">Duplicar</button>
              <button type="button" class="link-danger" data-quote-del="${quote.id}">Eliminar</button>
            </div>
          </td>
        </tr>`
      )
      .join("");
  }

  document.getElementById("quotes-filter-btn").addEventListener("click", renderQuotesTable);
  document.getElementById("quotes-search").addEventListener("input", renderQuotesTable);
  document.getElementById("quotes-status-filter").addEventListener("change", renderQuotesTable);

  document.getElementById("quotes-table-body").addEventListener("change", async (e) => {
    const id = e.target.dataset.quoteStatus;
    if (!id) return;
    const newStatus = e.target.value;
    const quote = state.quotes.find((q) => q.id === id);
    if (!quote) return;
    quote.estado = newStatus;

    if (isSupabaseConfigured) {
      await supabaseClient.from("quotes").update({ estado: newStatus }).eq("id", id);
    } else {
      saveLocalStore();
    }
    showToast(`Cotización N° ${quote.numero} actualizada a "${newStatus}"`);
  });

  document.getElementById("quotes-table-body").addEventListener("click", async (e) => {
    const viewId = e.target.dataset.quoteView;
    const editId = e.target.dataset.quoteEdit;
    const dupId = e.target.dataset.quoteDup;
    const delId = e.target.dataset.quoteDel;

    if (viewId) {
      openQuotePreview(viewId);
    } else if (editId) {
      openQuoteForm(editId);
    } else if (dupId) {
      await duplicateQuote(dupId);
    } else if (delId) {
      await deleteQuote(delId);
    }
  });

  async function duplicateQuote(id) {
    const orig = state.quotes.find((q) => q.id === id);
    if (!orig) return;

    const nextNum = Number(state.settings.proximo_num_cotizacion) || 1001;
    const copy = {
      ...orig,
      id: undefined,
      numero: nextNum,
      fecha: todayISO(),
      estado: "Borrador",
      items: JSON.parse(JSON.stringify(orig.items || []))
    };
    delete copy.id;
    delete copy.created_at;
    delete copy.updated_at;

    if (isSupabaseConfigured) {
      const { data, error } = await supabaseClient.from("quotes").insert(copy).select().single();
      if (error) {
        showToast("Error al duplicar: " + error.message);
        return;
      }
      state.quotes.unshift(data);
      state.settings.proximo_num_cotizacion = nextNum + 1;
      await supabaseClient
        .from("settings")
        .update({ proximo_num_cotizacion: nextNum + 1 })
        .eq("id", 1);
    } else {
      copy.id = generateLocalUUID();
      state.quotes.unshift(copy);
      state.settings.proximo_num_cotizacion = nextNum + 1;
      saveLocalStore();
    }

    renderQuotesTable();
    showToast(`Cotización duplicada como N° ${nextNum}`);
  }

  async function deleteQuote(id) {
    const q = state.quotes.find((item) => item.id === id);
    if (!q) return;
    if (!confirm(`¿Eliminar la cotización N° ${q.numero} de ${q.cliente_nombre}?`)) return;

    if (isSupabaseConfigured) {
      const { error } = await supabaseClient.from("quotes").delete().eq("id", id);
      if (error) {
        showToast("Error al eliminar: " + error.message);
        return;
      }
    }
    state.quotes = state.quotes.filter((item) => item.id !== id);
    saveLocalStore();
    renderQuotesTable();
    showToast("Cotización eliminada");
  }

  // ==================== 1B. CREAR / EDITAR COTIZACIÓN ====================
  document.getElementById("btn-new-quote").addEventListener("click", () => openQuoteForm(null));
  document.getElementById("btn-cancel-quote").addEventListener("click", () => switchView("quotes"));

  function refreshCustomerDropdowns() {
    const optionsHTML =
      '<option value="">— Escribir datos manualmente —</option>' +
      state.customers
        .map(
          (c) =>
            `<option value="${c.id}">${escapeHTML(c.nombre)}${c.rut ? " (" + escapeHTML(c.rut) + ")" : ""}</option>`
        )
        .join("");
    document.getElementById("qf-saved-customer").innerHTML = optionsHTML;
    document.getElementById("of-saved-customer").innerHTML = optionsHTML;
  }

  function refreshProductDatalist() {
    document.getElementById("products-datalist").innerHTML = state.products
      .map((p) => `<option value="${escapeHTML(p.descripcion)}"></option>`)
      .join("");
  }

  document.getElementById("qf-saved-customer").addEventListener("change", (e) => {
    const cust = state.customers.find((c) => c.id === e.target.value);
    if (!cust) return;
    document.getElementById("qf-cliente-nombre").value = cust.nombre || "";
    document.getElementById("qf-cliente-rut").value = cust.rut || "";
    document.getElementById("qf-cliente-telefono").value = cust.telefono || "";
    document.getElementById("qf-cliente-correo").value = cust.correo || "";
    document.getElementById("qf-cliente-direccion").value = cust.direccion || "";
  });

  document.getElementById("qf-aplicar-descuento").addEventListener("change", (e) => {
    document.getElementById("qf-descuento-group").classList.toggle("hidden", !e.target.checked);
    recalculateQuoteTotals();
  });

  document.getElementById("qf-descuento-pct").addEventListener("input", recalculateQuoteTotals);
  document.getElementById("qf-iva").addEventListener("input", recalculateQuoteTotals);

  function openQuoteForm(quoteId) {
    refreshCustomerDropdowns();
    refreshProductDatalist();
    const container = document.getElementById("quote-items-container");
    container.innerHTML = "";

    if (!quoteId) {
      const nextNum = Number(state.settings.proximo_num_cotizacion) || 1001;
      document.getElementById("quote-form-title").textContent = `Nueva cotización (N° ${nextNum})`;
      document.getElementById("qf-id").value = "";
      document.getElementById("qf-numero").value = nextNum;
      document.getElementById("qf-saved-customer").value = "";
      document.getElementById("qf-cliente-nombre").value = "";
      document.getElementById("qf-cliente-rut").value = "";
      document.getElementById("qf-cliente-telefono").value = "";
      document.getElementById("qf-cliente-correo").value = "";
      document.getElementById("qf-cliente-direccion").value = "";
      document.getElementById("qf-fecha").value = todayISO();
      document.getElementById("qf-validez").value = state.settings.validez_dias || 10;
      document.getElementById("qf-forma-pago").value = state.settings.forma_pago || "";
      document.getElementById("qf-aplicar-descuento").checked = false;
      document.getElementById("qf-descuento-group").classList.add("hidden");
      document.getElementById("qf-descuento-pct").value = 0;
      document.getElementById("qf-iva").value = state.settings.iva_porcentaje ?? 19;
      document.getElementById("qf-estado").value = "Borrador";
      document.getElementById("qf-observaciones").value = "";
      addQuoteItemRow({ descripcion: "", cantidad: 1, precio_unitario: 0 });
    } else {
      const q = state.quotes.find((item) => item.id === quoteId);
      if (!q) return;
      document.getElementById("quote-form-title").textContent = `Editar cotización (N° ${q.numero})`;
      document.getElementById("qf-id").value = q.id;
      document.getElementById("qf-numero").value = q.numero;
      document.getElementById("qf-saved-customer").value = q.cliente_id || "";
      document.getElementById("qf-cliente-nombre").value = q.cliente_nombre || "";
      document.getElementById("qf-cliente-rut").value = q.cliente_rut || "";
      document.getElementById("qf-cliente-telefono").value = q.cliente_telefono || "";
      document.getElementById("qf-cliente-correo").value = q.cliente_correo || "";
      document.getElementById("qf-cliente-direccion").value = q.cliente_direccion || "";
      document.getElementById("qf-fecha").value = q.fecha || todayISO();
      document.getElementById("qf-validez").value = q.validez_dias || 10;
      document.getElementById("qf-forma-pago").value = q.forma_pago || "";
      document.getElementById("qf-aplicar-descuento").checked = Boolean(q.aplicar_descuento);
      document.getElementById("qf-descuento-group").classList.toggle("hidden", !q.aplicar_descuento);
      document.getElementById("qf-descuento-pct").value = q.descuento_porcentaje || 0;
      document.getElementById("qf-iva").value = q.iva_porcentaje ?? 19;
      document.getElementById("qf-estado").value = q.estado || "Borrador";
      document.getElementById("qf-observaciones").value = q.observaciones || "";

      const items = Array.isArray(q.items) && q.items.length ? q.items : [{ descripcion: "", cantidad: 1, precio_unitario: 0 }];
      items.forEach((it) => addQuoteItemRow(it));
    }

    recalculateQuoteTotals();
    switchView("quote-form");
  }

  function addQuoteItemRow(item = { descripcion: "", cantidad: 1, precio_unitario: 0 }) {
    const container = document.getElementById("quote-items-container");
    const row = document.createElement("div");
    row.className = "item-editor-row";
    row.innerHTML = `
      <div>
        <input type="text" class="item-desc" list="products-datalist" placeholder="Escriba o elija un producto" value="${escapeHTML(item.descripcion || "")}" />
      </div>
      <div>
        <input type="number" class="item-qty" min="0.01" step="any" value="${item.cantidad ?? 1}" />
      </div>
      <div>
        <input type="number" class="item-price" min="0" step="1" placeholder="0" value="${item.precio_unitario || ""}" />
      </div>
      <div class="text-right font-bold item-line-total">$0</div>
      <div class="text-center">
        <button type="button" class="btn-remove-item" title="Quitar ítem">×</button>
      </div>
    `;

    const descInput = row.querySelector(".item-desc");
    const qtyInput = row.querySelector(".item-qty");
    const priceInput = row.querySelector(".item-price");

    // Autocompletar precio al elegir producto del catálogo
    descInput.addEventListener("change", () => {
      const val = descInput.value.trim().toLowerCase();
      const match = state.products.find((p) => p.descripcion.toLowerCase() === val);
      if (match && (!priceInput.value || Number(priceInput.value) === 0)) {
        priceInput.value = Number(match.precio_neto) || 0;
      }
      recalculateQuoteTotals();
    });

    qtyInput.addEventListener("input", recalculateQuoteTotals);
    priceInput.addEventListener("input", recalculateQuoteTotals);

    row.querySelector(".btn-remove-item").addEventListener("click", () => {
      if (container.children.length > 1) {
        row.remove();
        recalculateQuoteTotals();
      } else {
        descInput.value = "";
        qtyInput.value = 1;
        priceInput.value = "";
        recalculateQuoteTotals();
      }
    });

    container.appendChild(row);
    recalculateQuoteTotals();
  }

  document.getElementById("btn-add-quote-item").addEventListener("click", () => addQuoteItemRow());

  function collectQuoteItemsAndTotals() {
    const rows = Array.from(document.querySelectorAll("#quote-items-container .item-editor-row"));
    let subtotalNeto = 0;

    const items = rows.map((row) => {
      const descripcion = row.querySelector(".item-desc").value.trim();
      const cantidad = parseFloat(row.querySelector(".item-qty").value) || 0;
      const precio_unitario = parseFloat(row.querySelector(".item-price").value) || 0;
      const total_neto = Math.round(cantidad * precio_unitario);
      row.querySelector(".item-line-total").textContent = formatCLP(total_neto);
      subtotalNeto += total_neto;
      return { descripcion, cantidad, precio_unitario, total_neto };
    });

    const aplicarDescuento = document.getElementById("qf-aplicar-descuento").checked;
    const descuentoPct = aplicarDescuento ? parseFloat(document.getElementById("qf-descuento-pct").value) || 0 : 0;
    const descuentoMonto = Math.round(subtotalNeto * (descuentoPct / 100));
    const totalNeto = Math.max(0, subtotalNeto - descuentoMonto);
    const ivaPct = parseFloat(document.getElementById("qf-iva").value) || 0;
    const ivaMonto = Math.round(totalNeto * (ivaPct / 100));
    const totalConIva = totalNeto + ivaMonto;

    return {
      items,
      subtotalNeto,
      aplicarDescuento,
      descuentoPct,
      descuentoMonto,
      totalNeto,
      ivaPct,
      ivaMonto,
      totalConIva
    };
  }

  function recalculateQuoteTotals() {
    const calc = collectQuoteItemsAndTotals();
    document.getElementById("sum-subtotal").textContent = formatCLP(calc.subtotalNeto);

    const discRow = document.getElementById("sum-discount-row");
    if (calc.aplicarDescuento && calc.descuentoPct > 0) {
      discRow.classList.remove("hidden");
      document.getElementById("sum-discount-pct-label").textContent = calc.descuentoPct;
      document.getElementById("sum-discount").textContent = "-" + formatCLP(calc.descuentoMonto);
    } else {
      discRow.classList.add("hidden");
    }

    document.getElementById("sum-neto").textContent = formatCLP(calc.totalNeto);
    document.getElementById("sum-iva-label").textContent = calc.ivaPct;
    document.getElementById("sum-iva").textContent = formatCLP(calc.ivaMonto);
    document.getElementById("sum-total").textContent = formatCLP(calc.totalConIva);
  }

  document.getElementById("btn-save-quote").addEventListener("click", async () => {
    const clienteNombre = document.getElementById("qf-cliente-nombre").value.trim();
    if (!clienteNombre) {
      alert("Por favor ingrese el nombre de la Empresa o Cliente.");
      document.getElementById("qf-cliente-nombre").focus();
      return;
    }

    const calc = collectQuoteItemsAndTotals();
    const validItems = calc.items.filter((i) => i.descripcion !== "");
    if (!validItems.length) {
      alert("Agregue al menos un ítem con descripción a la cotización.");
      return;
    }

    const existingId = document.getElementById("qf-id").value;
    const numero = parseInt(document.getElementById("qf-numero").value, 10);

    const payload = {
      numero,
      fecha: document.getElementById("qf-fecha").value || todayISO(),
      validez_dias: parseInt(document.getElementById("qf-validez").value, 10) || 10,
      cliente_id: document.getElementById("qf-saved-customer").value || null,
      cliente_nombre: clienteNombre,
      cliente_rut: document.getElementById("qf-cliente-rut").value.trim(),
      cliente_telefono: document.getElementById("qf-cliente-telefono").value.trim(),
      cliente_correo: document.getElementById("qf-cliente-correo").value.trim(),
      cliente_direccion: document.getElementById("qf-cliente-direccion").value.trim(),
      forma_pago: document.getElementById("qf-forma-pago").value.trim(),
      aplicar_descuento: calc.aplicarDescuento,
      descuento_porcentaje: calc.descuentoPct,
      iva_porcentaje: calc.ivaPct,
      estado: document.getElementById("qf-estado").value,
      items: validItems,
      observaciones: document.getElementById("qf-observaciones").value.trim(),
      subtotal_neto: calc.subtotalNeto,
      descuento_monto: calc.descuentoMonto,
      total_neto: calc.totalNeto,
      iva_monto: calc.ivaMonto,
      total_con_iva: calc.totalConIva
    };

    const btn = document.getElementById("btn-save-quote");
    btn.disabled = true;

    try {
      let savedId = existingId;
      if (isSupabaseConfigured) {
        if (existingId) {
          const { data, error } = await supabaseClient
            .from("quotes")
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq("id", existingId)
            .select()
            .single();
          if (error) throw error;
          const idx = state.quotes.findIndex((q) => q.id === existingId);
          if (idx >= 0) state.quotes[idx] = data;
        } else {
          const { data, error } = await supabaseClient
            .from("quotes")
            .insert({ ...payload, created_by: state.user.id })
            .select()
            .single();
          if (error) throw error;
          state.quotes.unshift(data);
          savedId = data.id;

          const nextNum = numero + 1;
          state.settings.proximo_num_cotizacion = nextNum;
          await supabaseClient.from("settings").update({ proximo_num_cotizacion: nextNum }).eq("id", 1);
        }
      } else {
        if (existingId) {
          const idx = state.quotes.findIndex((q) => q.id === existingId);
          if (idx >= 0) state.quotes[idx] = { ...state.quotes[idx], ...payload };
        } else {
          savedId = generateLocalUUID();
          state.quotes.unshift({ id: savedId, ...payload });
          state.settings.proximo_num_cotizacion = numero + 1;
        }
        saveLocalStore();
      }

      renderQuotesTable();
      showToast(`Cotización N° ${numero} guardada`);
      openQuotePreview(savedId);
    } catch (err) {
      alert("Error al guardar cotización: " + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ==================== 1C. VISTA PREVIA / IMPRIMIR PDF COTIZACIÓN ====================
  function openQuotePreview(quoteId) {
    const q = state.quotes.find((item) => item.id === quoteId);
    if (!q) return;
    state.activeQuoteId = quoteId;

    const s = state.settings;
    const vencimiento = addDaysISO(q.fecha, q.validez_dias);

    const rowsHTML = (q.items || [])
      .map(
        (it, idx) => `
        <tr>
          <td class="text-center font-bold">${idx + 1}</td>
          <td>${escapeHTML(it.descripcion)}</td>
          <td class="text-center">${it.cantidad}</td>
          <td class="text-right">${formatCLP(it.precio_unitario)}</td>
          <td class="text-right font-bold">${formatCLP(it.total_neto)}</td>
        </tr>`
      )
      .join("");

    const discountRowHTML =
      q.aplicar_descuento && Number(q.descuento_monto) > 0
        ? `<tr><td>Descuento (${q.descuento_porcentaje}%)</td><td>-${formatCLP(q.descuento_monto)}</td></tr>`
        : "";

    document.getElementById("quote-print-document").innerHTML = `
      <div class="doc-header">
        <div class="doc-logo">
          <img
            src="../brand-logo.png"
            alt="${escapeHTML(s.razon_social)}"
            onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 260 64%22><rect width=%22260%22 height=%2264%22 rx=%2210%22 fill=%22%23111827%22/><polygon points=%2236,12 20,36 33,36 28,52 46,28 33,28%22 fill=%22%23FACC15%22/><text x=%2260%22 y=%2239%22 fill=%22%23FFFFFF%22 font-family=%22Arial,sans-serif%22 font-weight=%22800%22 font-size=%2222%22>ELECTROMACH</text></svg>';"
          />
        </div>
        <div class="doc-company-info">
          <div class="company-name">${escapeHTML(s.razon_social)}</div>
          ${s.rut ? `<div>R.U.T.: ${escapeHTML(s.rut)}</div>` : ""}
          ${s.telefono ? `<div>${escapeHTML(s.telefono)}</div>` : ""}
          ${s.sitio_web ? `<div>${escapeHTML(s.sitio_web)}</div>` : ""}
          ${s.correo ? `<div>${escapeHTML(s.correo)}</div>` : ""}
        </div>
      </div>

      <div class="doc-meta-grid">
        <div class="doc-meta-col">
          <div class="doc-meta-header-dark">DATOS DEL CLIENTE</div>
          <table class="doc-meta-table">
            <tr><td>Cliente</td><td class="font-bold">${escapeHTML(q.cliente_nombre)}</td></tr>
            <tr><td>RUT</td><td>${escapeHTML(q.cliente_rut || "")}</td></tr>
            <tr><td>Correo</td><td>${escapeHTML(q.cliente_correo || "")}</td></tr>
            <tr><td>Teléfono</td><td>${escapeHTML(q.cliente_telefono || "")}</td></tr>
            <tr><td>Dirección</td><td>${escapeHTML(q.cliente_direccion || "")}</td></tr>
          </table>
        </div>
        <div class="doc-meta-col">
          <div class="doc-meta-header-yellow">COTIZACIÓN</div>
          <table class="doc-meta-table">
            <tr><td>Cotización N°</td><td class="font-bold">${escapeHTML(q.numero)}</td></tr>
            <tr><td>Fecha</td><td>${formatDateCL(q.fecha)}</td></tr>
            <tr><td>Vencimiento</td><td>${formatDateCL(vencimiento)}</td></tr>
            <tr><td>Forma de pago</td><td>${escapeHTML(q.forma_pago || "")}</td></tr>
          </table>
        </div>
      </div>

      <table class="doc-items-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Descripción</th>
            <th class="text-center">Cant.</th>
            <th class="text-right">Precio unit. neto</th>
            <th class="text-right">Total neto</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHTML}
        </tbody>
      </table>

      <div class="doc-bottom-split">
        <div class="doc-obs">
          ${q.observaciones ? `<strong>Observaciones</strong>${escapeHTML(q.observaciones)}` : ""}
        </div>
        <div>
          <table class="doc-totals-table">
            <tr><td>Subtotal neto</td><td>${formatCLP(q.subtotal_neto)}</td></tr>
            ${discountRowHTML}
            <tr><td>Total neto</td><td>${formatCLP(q.total_neto)}</td></tr>
            <tr><td>IVA (${q.iva_porcentaje}%)</td><td>${formatCLP(q.iva_monto)}</td></tr>
            <tr class="doc-grand-total"><td>TOTAL</td><td>${formatCLP(q.total_con_iva)}</td></tr>
          </table>
        </div>
      </div>

      <div class="doc-terms-box">
        <div class="doc-terms-header">
          <div>MÉTODOS DE PAGO</div>
          <div>TÉRMINOS Y CONDICIONES</div>
        </div>
        <div class="doc-terms-body">
          <div>${escapeHTML(s.metodos_pago || "")}</div>
          <div>${escapeHTML(s.terminos_condiciones || "")}</div>
        </div>
      </div>

      <div class="doc-thanks-banner">${escapeHTML(s.mensaje_final || "¡GRACIAS POR HACER NEGOCIOS CON NOSOTROS!")}</div>
    `;

    switchView("quote-preview");
  }

  document.getElementById("btn-preview-back").addEventListener("click", () => {
    renderQuotesTable();
    switchView("quotes");
  });
  document.getElementById("btn-preview-edit").addEventListener("click", () => {
    if (state.activeQuoteId) openQuoteForm(state.activeQuoteId);
  });
  document.getElementById("btn-preview-print").addEventListener("click", () => window.print());

  // ==================== 2. ÓRDENES TÉCNICAS ====================
  function renderOrdersTable() {
    const tbody = document.getElementById("orders-table-body");
    const q = document.getElementById("orders-search").value.trim().toLowerCase();
    const st = document.getElementById("orders-status-filter").value;

    const filtered = state.orders.filter((ord) => {
      const matchText =
        !q ||
        String(ord.numero).includes(q) ||
        (ord.cliente_nombre || "").toLowerCase().includes(q) ||
        (ord.cliente_telefono || "").toLowerCase().includes(q) ||
        (ord.descripcion_servicio || "").toLowerCase().includes(q);
      const matchStatus = !st || ord.estado === st;
      return matchText && matchStatus;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay órdenes técnicas todavía.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map(
        (ord) => `
        <tr>
          <td class="font-bold">${escapeHTML(ord.numero)}</td>
          <td>${formatDateCL(ord.fecha)}</td>
          <td>${escapeHTML(ord.cliente_nombre)}</td>
          <td>${escapeHTML((ord.descripcion_servicio || "").slice(0, 55))}${(ord.descripcion_servicio || "").length > 55 ? "..." : ""}</td>
          <td class="text-right">${formatCLP(ord.valor_visita)}</td>
          <td>${escapeHTML(ord.recibido_por || "")}</td>
          <td>${escapeHTML(ord.estado)}</td>
          <td>
            <div class="action-links">
              <button type="button" class="link-action" data-order-view="${ord.id}">Ver / PDF</button>
              <button type="button" class="link-action" data-order-edit="${ord.id}">Editar</button>
              <button type="button" class="link-danger" data-order-del="${ord.id}">Eliminar</button>
            </div>
          </td>
        </tr>`
      )
      .join("");
  }

  document.getElementById("orders-filter-btn").addEventListener("click", renderOrdersTable);
  document.getElementById("orders-search").addEventListener("input", renderOrdersTable);
  document.getElementById("orders-status-filter").addEventListener("change", renderOrdersTable);

  document.getElementById("orders-table-body").addEventListener("click", async (e) => {
    const viewId = e.target.dataset.orderView;
    const editId = e.target.dataset.orderEdit;
    const delId = e.target.dataset.orderDel;
    if (viewId) openOrderPreview(viewId);
    if (editId) openOrderForm(editId);
    if (delId) {
      const ord = state.orders.find((o) => o.id === delId);
      if (!ord || !confirm(`¿Eliminar la orden técnica N° ${ord.numero}?`)) return;
      if (isSupabaseConfigured) {
        await supabaseClient.from("technical_orders").delete().eq("id", delId);
      }
      state.orders = state.orders.filter((o) => o.id !== delId);
      saveLocalStore();
      renderOrdersTable();
      showToast("Orden técnica eliminada");
    }
  });

  document.getElementById("btn-new-order").addEventListener("click", () => openOrderForm(null));
  document.getElementById("btn-cancel-order").addEventListener("click", () => switchView("orders"));

  document.getElementById("of-saved-customer").addEventListener("change", (e) => {
    const cust = state.customers.find((c) => c.id === e.target.value);
    if (!cust) return;
    document.getElementById("of-cliente-nombre").value = cust.nombre || "";
    document.getElementById("of-cliente-telefono").value = cust.telefono || "";
  });

  function openOrderForm(orderId) {
    refreshCustomerDropdowns();
    if (!orderId) {
      const nextNum = Number(state.settings.proximo_num_orden) || 501;
      document.getElementById("order-form-title").textContent = `Nueva orden técnica (N° ${nextNum})`;
      document.getElementById("of-id").value = "";
      document.getElementById("of-numero").value = nextNum;
      document.getElementById("of-saved-customer").value = "";
      document.getElementById("of-cliente-nombre").value = "";
      document.getElementById("of-cliente-telefono").value = "";
      document.getElementById("of-recibido-por").value = "";
      document.getElementById("of-valor-visita").value = 0;
      document.getElementById("of-fecha").value = todayISO();
      document.getElementById("of-estado").value = "Realizada";
      document.getElementById("of-descripcion").value = "";
      document.getElementById("of-observaciones").value = "";
    } else {
      const ord = state.orders.find((o) => o.id === orderId);
      if (!ord) return;
      document.getElementById("order-form-title").textContent = `Editar orden técnica (N° ${ord.numero})`;
      document.getElementById("of-id").value = ord.id;
      document.getElementById("of-numero").value = ord.numero;
      document.getElementById("of-saved-customer").value = ord.cliente_id || "";
      document.getElementById("of-cliente-nombre").value = ord.cliente_nombre || "";
      document.getElementById("of-cliente-telefono").value = ord.cliente_telefono || "";
      document.getElementById("of-recibido-por").value = ord.recibido_por || "";
      document.getElementById("of-valor-visita").value = ord.valor_visita || 0;
      document.getElementById("of-fecha").value = ord.fecha || todayISO();
      document.getElementById("of-estado").value = ord.estado || "Realizada";
      document.getElementById("of-descripcion").value = ord.descripcion_servicio || "";
      document.getElementById("of-observaciones").value = ord.observaciones || "";
    }
    switchView("order-form");
  }

  async function saveOrderHandler() {
    const clienteNombre = document.getElementById("of-cliente-nombre").value.trim();
    if (!clienteNombre) {
      alert("Ingrese el nombre del cliente.");
      document.getElementById("of-cliente-nombre").focus();
      return;
    }

    const existingId = document.getElementById("of-id").value;
    const numero = parseInt(document.getElementById("of-numero").value, 10);
    const payload = {
      numero,
      fecha: document.getElementById("of-fecha").value || todayISO(),
      cliente_id: document.getElementById("of-saved-customer").value || null,
      cliente_nombre: clienteNombre,
      cliente_telefono: document.getElementById("of-cliente-telefono").value.trim(),
      recibido_por: document.getElementById("of-recibido-por").value.trim(),
      valor_visita: parseFloat(document.getElementById("of-valor-visita").value) || 0,
      estado: document.getElementById("of-estado").value,
      descripcion_servicio: document.getElementById("of-descripcion").value.trim(),
      observaciones: document.getElementById("of-observaciones").value.trim()
    };

    try {
      let savedId = existingId;
      if (isSupabaseConfigured) {
        if (existingId) {
          const { data, error } = await supabaseClient
            .from("technical_orders")
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq("id", existingId)
            .select()
            .single();
          if (error) throw error;
          const idx = state.orders.findIndex((o) => o.id === existingId);
          if (idx >= 0) state.orders[idx] = data;
        } else {
          const { data, error } = await supabaseClient
            .from("technical_orders")
            .insert({ ...payload, created_by: state.user.id })
            .select()
            .single();
          if (error) throw error;
          state.orders.unshift(data);
          savedId = data.id;
          const nextNum = numero + 1;
          state.settings.proximo_num_orden = nextNum;
          await supabaseClient.from("settings").update({ proximo_num_orden: nextNum }).eq("id", 1);
        }
      } else {
        if (existingId) {
          const idx = state.orders.findIndex((o) => o.id === existingId);
          if (idx >= 0) state.orders[idx] = { ...state.orders[idx], ...payload };
        } else {
          savedId = generateLocalUUID();
          state.orders.unshift({ id: savedId, ...payload });
          state.settings.proximo_num_orden = numero + 1;
        }
        saveLocalStore();
      }

      renderOrdersTable();
      showToast(`Orden técnica N° ${numero} guardada`);
      openOrderPreview(savedId);
    } catch (err) {
      alert("Error al guardar orden técnica: " + err.message);
    }
  }

  document.getElementById("btn-save-order").addEventListener("click", saveOrderHandler);
  document.getElementById("btn-save-order-bottom").addEventListener("click", saveOrderHandler);

  function openOrderPreview(orderId) {
    const ord = state.orders.find((o) => o.id === orderId);
    if (!ord) return;
    state.activeOrderId = orderId;
    const s = state.settings;

    document.getElementById("order-print-document").innerHTML = `
      <div class="doc-header">
        <div class="doc-logo">
          <img
            src="../brand-logo.png"
            alt="${escapeHTML(s.razon_social)}"
            onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 260 64%22><rect width=%22260%22 height=%2264%22 rx=%2210%22 fill=%22%23111827%22/><polygon points=%2236,12 20,36 33,36 28,52 46,28 33,28%22 fill=%22%23FACC15%22/><text x=%2260%22 y=%2239%22 fill=%22%23FFFFFF%22 font-family=%22Arial,sans-serif%22 font-weight=%22800%22 font-size=%2222%22>ELECTROMACH</text></svg>';"
          />
        </div>
        <div class="doc-company-info">
          <div class="company-name">${escapeHTML(s.razon_social)}</div>
          ${s.rut ? `<div>R.U.T.: ${escapeHTML(s.rut)}</div>` : ""}
          ${s.telefono ? `<div>${escapeHTML(s.telefono)}</div>` : ""}
          ${s.sitio_web ? `<div>${escapeHTML(s.sitio_web)}</div>` : ""}
          ${s.correo ? `<div>${escapeHTML(s.correo)}</div>` : ""}
        </div>
      </div>

      <div class="doc-meta-grid">
        <div class="doc-meta-col">
          <div class="doc-meta-header-dark">DATOS DEL CLIENTE</div>
          <table class="doc-meta-table">
            <tr><td>Cliente</td><td class="font-bold">${escapeHTML(ord.cliente_nombre)}</td></tr>
            <tr><td>Teléfono</td><td>${escapeHTML(ord.cliente_telefono || "")}</td></tr>
            <tr><td>Recibido por</td><td>${escapeHTML(ord.recibido_por || "")}</td></tr>
          </table>
        </div>
        <div class="doc-meta-col">
          <div class="doc-meta-header-yellow">ORDEN TÉCNICA</div>
          <table class="doc-meta-table">
            <tr><td>Orden N°</td><td class="font-bold">${escapeHTML(ord.numero)}</td></tr>
            <tr><td>Fecha</td><td>${formatDateCL(ord.fecha)}</td></tr>
            <tr><td>Estado</td><td>${escapeHTML(ord.estado)}</td></tr>
            <tr><td>Valor visita</td><td class="font-bold">${formatCLP(ord.valor_visita)}</td></tr>
          </table>
        </div>
      </div>

      <div class="doc-terms-box">
        <div class="doc-meta-header-dark">DESCRIPCIÓN DEL SERVICIO PRESTADO</div>
        <div style="padding: 14px; font-size: 12.5px; white-space: pre-line; min-height: 110px;">${escapeHTML(ord.descripcion_servicio || "Sin detalle registrado.")}</div>
      </div>

      <div class="doc-terms-box">
        <div class="doc-meta-header-dark">OBSERVACIONES Y MATERIALES UTILIZADOS</div>
        <div style="padding: 14px; font-size: 12.5px; white-space: pre-line; min-height: 90px;">${escapeHTML(ord.observaciones || "Sin observaciones adicionales.")}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 56px; margin-bottom: 24px; text-align: center; font-size: 12px;">
        <div>
          <div style="border-top: 1px solid #374151; padding-top: 6px; font-weight: 700;">Firma Técnico Electromach</div>
        </div>
        <div>
          <div style="border-top: 1px solid #374151; padding-top: 6px; font-weight: 700;">Firma Recepción Conforme (${escapeHTML(ord.recibido_por || "Cliente")})</div>
        </div>
      </div>

      <div class="doc-thanks-banner">${escapeHTML(s.mensaje_final || "¡GRACIAS POR CONFIAR EN ELECTROMACH!")}</div>
    `;

    switchView("order-preview");
  }

  document.getElementById("btn-order-preview-back").addEventListener("click", () => {
    renderOrdersTable();
    switchView("orders");
  });
  document.getElementById("btn-order-preview-edit").addEventListener("click", () => {
    if (state.activeOrderId) openOrderForm(state.activeOrderId);
  });
  document.getElementById("btn-order-preview-print").addEventListener("click", () => window.print());

  // ==================== 3. CLIENTES ====================
  function renderCustomersTable() {
    const tbody = document.getElementById("customers-table-body");
    const q = document.getElementById("customers-search").value.trim().toLowerCase();

    const filtered = state.customers.filter(
      (c) =>
        !q ||
        (c.nombre || "").toLowerCase().includes(q) ||
        (c.rut || "").toLowerCase().includes(q)
    );

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No hay clientes registrados.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map(
        (c) => `
        <tr>
          <td class="font-bold">${escapeHTML(c.nombre)}</td>
          <td>${escapeHTML(c.rut || "")}</td>
          <td>${escapeHTML(c.correo || "")}</td>
          <td>${escapeHTML(c.telefono || "")}</td>
          <td>
            <div class="action-links">
              <button type="button" class="link-action" data-cust-edit="${c.id}">Editar</button>
              <button type="button" class="link-danger" data-cust-del="${c.id}">Eliminar</button>
            </div>
          </td>
        </tr>`
      )
      .join("");
  }

  document.getElementById("customers-search-btn").addEventListener("click", renderCustomersTable);
  document.getElementById("customers-search").addEventListener("input", renderCustomersTable);

  function resetCustomerForm() {
    document.getElementById("customer-form-heading").textContent = "NUEVO CLIENTE";
    document.getElementById("cf-id").value = "";
    document.getElementById("cf-nombre").value = "";
    document.getElementById("cf-rut").value = "";
    document.getElementById("cf-correo").value = "";
    document.getElementById("cf-telefono").value = "";
    document.getElementById("cf-direccion").value = "";
    document.getElementById("cf-submit-btn").textContent = "Agregar cliente";
    document.getElementById("cf-cancel-edit").classList.add("hidden");
  }

  document.getElementById("cf-cancel-edit").addEventListener("click", resetCustomerForm);

  document.getElementById("customer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("cf-id").value;
    const payload = {
      nombre: document.getElementById("cf-nombre").value.trim(),
      rut: document.getElementById("cf-rut").value.trim(),
      correo: document.getElementById("cf-correo").value.trim(),
      telefono: document.getElementById("cf-telefono").value.trim(),
      direccion: document.getElementById("cf-direccion").value.trim()
    };

    try {
      if (isSupabaseConfigured) {
        if (id) {
          const { data, error } = await supabaseClient.from("customers").update(payload).eq("id", id).select().single();
          if (error) throw error;
          const idx = state.customers.findIndex((c) => c.id === id);
          if (idx >= 0) state.customers[idx] = data;
        } else {
          const { data, error } = await supabaseClient.from("customers").insert(payload).select().single();
          if (error) throw error;
          state.customers.push(data);
        }
      } else {
        if (id) {
          const idx = state.customers.findIndex((c) => c.id === id);
          if (idx >= 0) state.customers[idx] = { ...state.customers[idx], ...payload };
        } else {
          state.customers.push({ id: generateLocalUUID(), ...payload });
        }
        saveLocalStore();
      }

      state.customers.sort((a, b) => a.nombre.localeCompare(b.nombre));
      resetCustomerForm();
      renderCustomersTable();
      refreshCustomerDropdowns();
      showToast("Cliente guardado correctamente");
    } catch (err) {
      alert("Error al guardar cliente: " + err.message);
    }
  });

  document.getElementById("customers-table-body").addEventListener("click", async (e) => {
    const editId = e.target.dataset.custEdit;
    const delId = e.target.dataset.custDel;
    if (editId) {
      const c = state.customers.find((item) => item.id === editId);
      if (!c) return;
      document.getElementById("customer-form-heading").textContent = "EDITAR CLIENTE";
      document.getElementById("cf-id").value = c.id;
      document.getElementById("cf-nombre").value = c.nombre || "";
      document.getElementById("cf-rut").value = c.rut || "";
      document.getElementById("cf-correo").value = c.correo || "";
      document.getElementById("cf-telefono").value = c.telefono || "";
      document.getElementById("cf-direccion").value = c.direccion || "";
      document.getElementById("cf-submit-btn").textContent = "Guardar cambios";
      document.getElementById("cf-cancel-edit").classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (delId) {
      const c = state.customers.find((item) => item.id === delId);
      if (!c || !confirm(`¿Eliminar al cliente "${c.nombre}"?`)) return;
      if (isSupabaseConfigured) {
        await supabaseClient.from("customers").delete().eq("id", delId);
      }
      state.customers = state.customers.filter((item) => item.id !== delId);
      saveLocalStore();
      renderCustomersTable();
      refreshCustomerDropdowns();
      showToast("Cliente eliminado");
    }
  });

  // ==================== 4. PRODUCTOS Y SERVICIOS ====================
  function renderProductsTable() {
    const tbody = document.getElementById("products-table-body");
    const q = document.getElementById("products-search").value.trim().toLowerCase();

    const filtered = state.products.filter(
      (p) => !q || (p.descripcion || "").toLowerCase().includes(q)
    );

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No hay productos registrados.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map(
        (p) => `
        <tr>
          <td>${escapeHTML(p.descripcion)}</td>
          <td class="text-right font-bold">${formatCLP(p.precio_neto)}</td>
          <td>
            <div class="action-links">
              <button type="button" class="link-action" data-prod-edit="${p.id}">Editar</button>
              <button type="button" class="link-danger" data-prod-del="${p.id}">Eliminar</button>
            </div>
          </td>
        </tr>`
      )
      .join("");
  }

  document.getElementById("products-search-btn").addEventListener("click", renderProductsTable);
  document.getElementById("products-search").addEventListener("input", renderProductsTable);

  function resetProductForm() {
    document.getElementById("product-form-heading").textContent = "NUEVO PRODUCTO";
    document.getElementById("pf-id").value = "";
    document.getElementById("pf-descripcion").value = "";
    document.getElementById("pf-precio").value = "";
    document.getElementById("pf-submit-btn").textContent = "Agregar producto";
    document.getElementById("pf-cancel-edit").classList.add("hidden");
  }

  document.getElementById("pf-cancel-edit").addEventListener("click", resetProductForm);

  document.getElementById("product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("pf-id").value;
    const payload = {
      descripcion: document.getElementById("pf-descripcion").value.trim(),
      precio_neto: parseFloat(document.getElementById("pf-precio").value) || 0
    };

    try {
      if (isSupabaseConfigured) {
        if (id) {
          const { data, error } = await supabaseClient.from("products").update(payload).eq("id", id).select().single();
          if (error) throw error;
          const idx = state.products.findIndex((p) => p.id === id);
          if (idx >= 0) state.products[idx] = data;
        } else {
          const { data, error } = await supabaseClient.from("products").insert(payload).select().single();
          if (error) throw error;
          state.products.push(data);
        }
      } else {
        if (id) {
          const idx = state.products.findIndex((p) => p.id === id);
          if (idx >= 0) state.products[idx] = { ...state.products[idx], ...payload };
        } else {
          state.products.push({ id: generateLocalUUID(), ...payload });
        }
        saveLocalStore();
      }

      state.products.sort((a, b) => a.descripcion.localeCompare(b.descripcion));
      resetProductForm();
      renderProductsTable();
      refreshProductDatalist();
      showToast("Producto guardado correctamente");
    } catch (err) {
      alert("Error al guardar producto: " + err.message);
    }
  });

  document.getElementById("products-table-body").addEventListener("click", async (e) => {
    const editId = e.target.dataset.prodEdit;
    const delId = e.target.dataset.prodDel;
    if (editId) {
      const p = state.products.find((item) => item.id === editId);
      if (!p) return;
      document.getElementById("product-form-heading").textContent = "EDITAR PRODUCTO";
      document.getElementById("pf-id").value = p.id;
      document.getElementById("pf-descripcion").value = p.descripcion;
      document.getElementById("pf-precio").value = p.precio_neto;
      document.getElementById("pf-submit-btn").textContent = "Guardar cambios";
      document.getElementById("pf-cancel-edit").classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (delId) {
      const p = state.products.find((item) => item.id === delId);
      if (!p || !confirm(`¿Eliminar "${p.descripcion}"?`)) return;
      if (isSupabaseConfigured) {
        await supabaseClient.from("products").delete().eq("id", delId);
      }
      state.products = state.products.filter((item) => item.id !== delId);
      saveLocalStore();
      renderProductsTable();
      refreshProductDatalist();
      showToast("Producto eliminado");
    }
  });

  // ==================== 5. USUARIOS ====================
  function renderUsersTable() {
    const tbody = document.getElementById("users-table-body");
    if (!state.users.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No hay usuarios registrados.</td></tr>';
      return;
    }

    tbody.innerHTML = state.users
      .map((u) => {
        const isMe = state.user && u.id === state.user.id;
        return `
          <tr>
            <td><strong>${escapeHTML(u.nombre)}</strong> ${isMe ? '<span style="color:#6b7280;font-size:12px;">(usted)</span>' : ""}</td>
            <td>${escapeHTML(u.correo)}</td>
            <td>${formatDateCL(u.created_at)}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                ${
                  isMe
                    ? `<input type="password" id="my-new-pass" placeholder="Nueva contraseña" style="width:155px;padding:5px 8px;font-size:12.5px;" />
                       <button type="button" class="link-action" id="btn-change-my-pass">Cambiar clave</button>`
                    : `<button type="button" class="link-danger" data-user-del="${u.id}">Eliminar</button>`
                }
              </div>
            </td>
          </tr>`;
      })
      .join("");
  }

  document.getElementById("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = document.getElementById("uf-nombre").value.trim();
    const email = document.getElementById("uf-correo").value.trim();
    const password = document.getElementById("uf-password").value;

    try {
      if (isSupabaseConfigured) {
        // Cliente secundario sin persistencia de sesión para no cerrar la sesión del admin actual
        const tempClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        const { data, error } = await tempClient.auth.signUp({
          email,
          password,
          options: { data: { nombre } }
        });
        if (error) throw error;

        if (data.user) {
          await supabaseClient
            .from("profiles")
            .upsert({ id: data.user.id, nombre, correo: email });
          state.users.push({
            id: data.user.id,
            nombre,
            correo: email,
            created_at: new Date().toISOString()
          });
        }
      } else {
        state.users.push({
          id: generateLocalUUID(),
          nombre,
          correo: email,
          created_at: new Date().toISOString()
        });
        saveLocalStore();
      }

      document.getElementById("uf-nombre").value = "";
      document.getElementById("uf-correo").value = "";
      document.getElementById("uf-password").value = "";
      renderUsersTable();
      showToast(`Usuario ${nombre} creado correctamente`);
    } catch (err) {
      alert("Error al crear usuario: " + err.message);
    }
  });

  document.getElementById("users-table-body").addEventListener("click", async (e) => {
    if (e.target.id === "btn-change-my-pass") {
      const newPass = document.getElementById("my-new-pass").value;
      if (!newPass || newPass.length < 8) {
        alert("La nueva contraseña debe tener al menos 8 caracteres.");
        return;
      }
      if (isSupabaseConfigured) {
        const { error } = await supabaseClient.auth.updateUser({ password: newPass });
        if (error) {
          alert("Error al cambiar clave: " + error.message);
          return;
        }
      }
      document.getElementById("my-new-pass").value = "";
      showToast("Contraseña actualizada correctamente");
    }

    const delId = e.target.dataset.userDel;
    if (delId) {
      if (!confirm("¿Quitar este usuario del listado de acceso?")) return;
      if (isSupabaseConfigured) {
        await supabaseClient.from("profiles").delete().eq("id", delId);
      }
      state.users = state.users.filter((u) => u.id !== delId);
      saveLocalStore();
      renderUsersTable();
      showToast("Usuario eliminado del listado");
    }
  });

  // ==================== 6. CONFIGURACIÓN ====================
  function fillSettingsForm() {
    const s = state.settings;
    document.getElementById("sf-razon-social").value = s.razon_social || "";
    document.getElementById("sf-rut").value = s.rut || "";
    document.getElementById("sf-telefono").value = s.telefono || "";
    document.getElementById("sf-sitio-web").value = s.sitio_web || "";
    document.getElementById("sf-correo").value = s.correo || "";
    document.getElementById("sf-iva").value = s.iva_porcentaje ?? 19;
    document.getElementById("sf-validez").value = s.validez_dias ?? 10;
    document.getElementById("sf-next-quote").value = s.proximo_num_cotizacion ?? 1001;
    document.getElementById("sf-next-order").value = s.proximo_num_orden ?? 501;
    document.getElementById("sf-forma-pago").value = s.forma_pago || "";
    document.getElementById("sf-metodos-pago").value = s.metodos_pago || "";
    document.getElementById("sf-terminos").value = s.terminos_condiciones || "";
    document.getElementById("sf-mensaje-final").value = s.mensaje_final || "";
  }

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const updated = {
      id: 1,
      razon_social: document.getElementById("sf-razon-social").value.trim(),
      rut: document.getElementById("sf-rut").value.trim(),
      telefono: document.getElementById("sf-telefono").value.trim(),
      sitio_web: document.getElementById("sf-sitio-web").value.trim(),
      correo: document.getElementById("sf-correo").value.trim(),
      iva_porcentaje: parseFloat(document.getElementById("sf-iva").value) || 19,
      validez_dias: parseInt(document.getElementById("sf-validez").value, 10) || 10,
      proximo_num_cotizacion: parseInt(document.getElementById("sf-next-quote").value, 10) || 1001,
      proximo_num_orden: parseInt(document.getElementById("sf-next-order").value, 10) || 501,
      forma_pago: document.getElementById("sf-forma-pago").value.trim(),
      metodos_pago: document.getElementById("sf-metodos-pago").value.trim(),
      terminos_condiciones: document.getElementById("sf-terminos").value.trim(),
      mensaje_final: document.getElementById("sf-mensaje-final").value.trim(),
      updated_at: new Date().toISOString()
    };

    try {
      if (isSupabaseConfigured) {
        const { error } = await supabaseClient.from("settings").upsert(updated);
        if (error) throw error;
      }
      Object.assign(state.settings, updated);
      saveLocalStore();
      showToast("Configuración guardada correctamente");
    } catch (err) {
      alert("Error al guardar configuración: " + err.message);
    }
  });

  // Inicializar aplicación
  checkInitialSession();
})();

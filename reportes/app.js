const DUENOS_EMAILS = ['gustavo@electromach.cl', 'matias@electromach.cl'];

(function () {
  'use strict';

  const config = window.ELECTROMACH_CONFIG || {};
  const supabaseConfigured =
    typeof config.SUPABASE_URL === 'string' &&
    config.SUPABASE_URL.startsWith('https://') &&
    typeof config.SUPABASE_ANON_KEY === 'string' &&
    config.SUPABASE_ANON_KEY.length > 20;
  const supabaseClient = supabaseConfigured
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
    : null;
  const state = { user: null, isOwner: false, reports: [] };
  const $ = (id) => document.getElementById(id);

  function todayISO() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(value) {
    if (!value) return 'Sin fecha';
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return year && month && day ? `${day}-${month}-${year}` : value;
  }

  function ownerName(email) {
    return email === 'gustavo@electromach.cl' ? 'Gustavo' : 'Matías';
  }

  function showMessage(id, message, type) {
    const element = $(id);
    element.textContent = message;
    element.className = `alert ${type || ''}`;
    element.classList.remove('hidden');
  }

  function hideMessage(id) {
    $(id).classList.add('hidden');
  }

  function isOwnerEmail(email) {
    return DUENOS_EMAILS.includes(String(email || '').trim().toLowerCase());
  }

  function setUser(user) {
    state.user = user;
    const email = String(user.email || '').toLowerCase();
    state.isOwner = isOwnerEmail(email);
    $('current-user').textContent = user.user_metadata?.nombre || user.email;
    $('role-description').textContent = state.isOwner
      ? 'Vista de gerencia: revisa las jornadas y entrega retroalimentación.'
      : 'Registra tu jornada y consulta las observaciones publicadas por gerencia.';
    $('worker-form-section').classList.toggle('hidden', state.isOwner);
    $('owner-filters').classList.toggle('hidden', !state.isOwner);
    $('login-view').classList.add('hidden');
    $('app-shell').classList.remove('hidden');
    if (!state.isOwner) {
      $('worker-name').value = user.user_metadata?.nombre || user.email.split('@')[0];
    }
  }

  async function loadSession() {
    if (!supabaseConfigured) {
      showMessage('login-error', 'Supabase no está configurado. Revisa cotizador/config.js.', 'error');
      return;
    }
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session?.user) {
      setUser(data.session.user);
      await loadReports();
    }
  }

  async function loadReports() {
    const worker = $('filter-worker').value.trim();
    const date = $('filter-date').value;
    let query = supabaseClient.from('reportes_diarios').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false });
    if (!state.isOwner) query = query.eq('trabajador_id', state.user.id);
    if (state.isOwner && worker) query = query.ilike('nombre_trabajador', `%${worker}%`);
    if (date) query = query.eq('fecha', date);
    const { data, error } = await query;
    if (error) {
      showMessage('history-message', `No se pudieron cargar los reportes: ${error.message}`, 'error');
      return;
    }
    state.reports = data || [];
    renderReports();
  }

  function renderFeedback(report) {
    const type = report.tipo_feedback === 'felicitacion' ? 'is-praise' : report.tipo_feedback === 'mejora' ? 'is-improvement' : '';
    const typeLabel = report.tipo_feedback === 'felicitacion' ? 'Felicitación' : 'Oportunidad de mejora';
    const existing = report.comentario_dueno
      ? `<div class="feedback-panel ${type}">
          <div class="feedback-header"><h4>Nota de gerencia · ${escapeHTML(typeLabel)}</h4>${state.isOwner ? '<button class="button button-secondary edit-feedback" type="button">Editar</button>' : ''}</div>
          <p class="feedback-note">${escapeHTML(report.comentario_dueno)}</p>
          <p class="feedback-byline">${escapeHTML(report.autor_comentario || 'Gerencia')}${report.fecha_comentario ? ` · ${formatDate(report.fecha_comentario)}` : ''}</p>
        </div>`
      : '';
    if (!state.isOwner) return existing || '<div class="feedback-panel"><h4>Nota de gerencia</h4><p class="feedback-byline">Aún no hay una observación publicada.</p></div>';
    return `${existing}<div class="feedback-panel feedback-editor ${existing ? 'hidden' : ''}">
      <h4>${existing ? 'Editar nota de gerencia' : 'Retroalimentación de gerencia'}</h4>
      <form class="feedback-form">
        <select class="feedback-type" aria-label="Tipo de nota">
          <option value="felicitacion" ${report.tipo_feedback === 'felicitacion' ? 'selected' : ''}>Felicitación</option>
          <option value="mejora" ${report.tipo_feedback === 'mejora' ? 'selected' : ''}>Oportunidad de mejora</option>
        </select>
        <textarea class="feedback-comment" rows="2" placeholder="Escribe tu observación" required>${escapeHTML(report.comentario_dueno || '')}</textarea>
        <button class="button button-primary" type="submit">Guardar nota</button>
      </form>
    </div>`;
  }

  function renderReports() {
    if (!state.reports.length) {
      $('reports-list').innerHTML = '<div class="empty-state">No se encontraron reportes con estos filtros.</div>';
      return;
    }
    $('reports-list').innerHTML = state.reports.map((report) => `
      <article class="report-card" data-id="${escapeHTML(report.id)}">
        <div class="report-card-header">
          <div><h3>${escapeHTML(report.nombre_trabajador || 'Trabajador sin nombre')}</h3><div class="report-meta"><span>${formatDate(report.fecha)}</span><span>${escapeHTML(report.hora_entrada || '—')} a ${escapeHTML(report.hora_salida || '—')}</span></div></div>
          <span class="report-date">ID: ${escapeHTML(String(report.id).slice(0, 8))}</span>
        </div>
        <div class="report-content">
          <div><h4>Actividades realizadas</h4><p>${escapeHTML(report.actividades || 'Sin detalle')}</p></div>
          <div><h4>Pendientes</h4><p>${escapeHTML(report.pendientes || 'Ninguno informado')}</p></div>
        </div>
        ${renderFeedback(report)}
      </article>`).join('');
  }

  async function handleLogin(event) {
    event.preventDefault();
    hideMessage('login-error');
    const button = $('login-submit');
    button.disabled = true;
    button.textContent = 'Ingresando...';
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: $('login-email').value.trim(),
        password: $('login-password').value
      });
      if (error) throw error;
      setUser(data.user);
      await loadReports();
    } catch (error) {
      showMessage('login-error', `No se pudo iniciar sesión: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Ingresar';
    }
  }

  async function handleReportSubmit(event) {
    event.preventDefault();
    const payload = {
      fecha: $('report-date').value,
      trabajador_id: state.user.id,
      nombre_trabajador: $('worker-name').value.trim(),
      hora_entrada: $('start-time').value,
      hora_salida: $('end-time').value,
      actividades: $('activities').value.trim(),
      pendientes: $('pending').value.trim()
    };
    const { error } = await supabaseClient.from('reportes_diarios').insert(payload);
    if (error) {
      showMessage('form-message', `No se pudo guardar la bitácora: ${error.message}`, 'error');
      return;
    }
    $('activities').value = '';
    $('pending').value = '';
    $('report-date').value = todayISO();
    showMessage('form-message', 'Bitácora enviada correctamente.', 'success');
    await loadReports();
  }

  async function handleFeedbackSubmit(event) {
    const form = event.target.closest('.feedback-form');
    if (!form) return;
    event.preventDefault();
    const card = form.closest('.report-card');
    const reportId = card.dataset.id;
    const payload = {
      tipo_feedback: form.querySelector('.feedback-type').value,
      comentario_dueno: form.querySelector('.feedback-comment').value.trim(),
      autor_comentario: ownerName(String(state.user.email).toLowerCase()),
      fecha_comentario: new Date().toISOString()
    };
    const { error } = await supabaseClient.from('reportes_diarios').update(payload).eq('id', reportId);
    if (error) {
      showMessage('history-message', `No se pudo guardar la nota: ${error.message}`, 'error');
      return;
    }
    showMessage('history-message', 'Nota de gerencia guardada.', 'success');
    await loadReports();
  }

  $('login-form').addEventListener('submit', handleLogin);
  $('report-form').addEventListener('submit', handleReportSubmit);
  $('reports-list').addEventListener('submit', handleFeedbackSubmit);
  $('reports-list').addEventListener('click', (event) => {
    if (!event.target.classList.contains('edit-feedback')) return;
    const card = event.target.closest('.report-card');
    card.querySelector('.feedback-editor').classList.remove('hidden');
  });
  $('refresh-btn').addEventListener('click', loadReports);
  $('filter-worker').addEventListener('input', loadReports);
  $('filter-date').addEventListener('change', loadReports);
  $('clear-filters').addEventListener('click', () => {
    $('filter-worker').value = '';
    $('filter-date').value = '';
    loadReports();
  });
  $('logout-btn').addEventListener('click', async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      showMessage('history-message', `No se pudo cerrar sesión: ${error.message}`, 'error');
      return;
    }
    window.location.reload();
  });

  $('report-date').value = todayISO();
  loadSession().catch((error) => showMessage('login-error', `No se pudo validar la sesión: ${error.message}`, 'error'));
})();

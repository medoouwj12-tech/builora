(() => {
  'use strict';
  const KEY = 'madar_workspace_v1';
  const STATUSES = ['جديد', 'تم التواصل', 'مهتم', 'عرض سعر', 'تفاوض', 'عميل حالي', 'غير مهتم'];
  const SECTORS = ['عيادات ومراكز طبية', 'تعليم ومدارس', 'عقارات', 'مطاعم وكافيهات', 'تجزئة وسوبرماركت', 'فنادق وسياحة', 'سياحة وسفر', 'لوجستيات وشحن', 'محاسبة وخدمات مهنية', 'أخرى'];
  const ROUTES = { overview: 'نظرة عامة', leads: 'العملاء والفرص', team: 'فريق السيلز', offers: 'العروض والصفقات', projects: 'المشاريع', reports: 'التقارير', settings: 'الإعدادات' };
  const DEFAULT_TEAM = [
    { id: 'owner', name: 'محمد', email: 'mohamed@madar.demo', role: 'المدير', initials: 'م', color: '#4ccfc1', password: '123456' },
    { id: 'sara', name: 'سارة', email: 'sara@madar.demo', role: 'سيلز', initials: 'س', color: '#a78bfa', password: '123456' },
    { id: 'nour', name: 'نور', email: 'nour@madar.demo', role: 'سيلز', initials: 'ن', color: '#64a7ff', password: '123456' },
    { id: 'mariam', name: 'مريم', email: 'mariam@madar.demo', role: 'سيلز', initials: 'م', color: '#f1a978', password: '123456' }
  ];
  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];
  const enc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmt = n => new Intl.NumberFormat('ar-EG').format(Number(n || 0));
  const money = n => `${fmt(n)} ج.م`;
  const dayLabel = date => date ? new Date(`${date}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) : '—';
  const defaultState = () => ({ leads: (window.INITIAL_LEADS || []).map(x => ({ ...x, status: 'جديد', owner: '' })), team: DEFAULT_TEAM, activities: [], offers: [], projects: [], target: 250000, banner: true, createdAt: today() });
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || defaultState(); } catch { state = defaultState(); }
  if (!Array.isArray(state.leads)) state.leads = defaultState().leads;
  if (!Array.isArray(state.team) || !state.team.length) state.team = DEFAULT_TEAM;
  state.team = state.team.map(member => ({ ...member, password: member.password || '123456' }));
  state.activities ||= []; state.offers ||= []; state.projects ||= []; state.target ||= 250000;
  let currentUser = null; let currentRoute = 'overview'; let leadFilter = ''; let apiMode = false; let setupRequired = false; let registerMode = false;
  const shell = $('#appShell'), login = $('#loginScreen'), content = $('#content'), modalRoot = $('#modalRoot');

  function save() {
    if (!apiMode) { localStorage.setItem(KEY, JSON.stringify(state)); return; }
    fetch('/api/state', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) })
      .then(async response => { if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'تعذر حفظ التغييرات'); } })
      .catch(error => toast(error.message || 'تعذر حفظ التغييرات على الخادم'));
  }
  async function apiRequest(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'تعذر إكمال الطلب');
    return data;
  }
  async function loadApiState(user = null) {
    const remote = await apiRequest('/api/state');
    state = { ...state, ...remote, team: remote.team.map(member => ({ ...member, email: member.username })) };
    currentUser = remote.user ? { ...remote.user, email: remote.user.username } : user; return remote;
  }
  function userById(id) { return state.team.find(p => p.id === id); }
  function visibleLeads() { return currentUser?.role === 'المدير' ? state.leads : state.leads.filter(l => !l.owner || l.owner === currentUser?.id); }
  function shownActivities() { return currentUser?.role === 'المدير' ? state.activities : state.activities.filter(a => a.userId === currentUser?.id); }
  function ownerName(id) { return userById(id)?.name || 'غير مُعيّن'; }
  function statusClass(s) { return `status-${String(s).replaceAll(' ', '-')}`; }
  function initials(name) { return String(name || '?').trim().slice(0, 1); }
  function safePhone(phoneString) { const m = String(phoneString || '').match(/(?:محمول|أرضي|خط ساخن):\s*([+\d][\d\s()-]{4,})|\b(01[0125][\d\s-]{8,}|0\d{1,2}-[\d-]{6,}|1\d{4})/); return (m?.[1] || m?.[2] || '').replace(/[\s()-]/g, ''); }
  function whatsappUrl(lead) {
    const listed = String(lead?.whatsapp || '').match(/(?:phone=|wa\.me\/)(\+?\d{10,15})/i);
    if (listed) return makeWhatsAppLink(listed[1].replace(/\D/g, ''), lead);
    return '';
  }
  function whatsappDigits(value) { return String(value || '').match(/(?:wa\.me\/|phone=)\+?(\d{10,15})/i)?.[1] || ''; }
  function makeWhatsAppLink(international, lead) {
    const text = `أهلًا، أنا [اسمك] من شركة [اسم الشركة] لتطوير البرمجيات. حابب أتعرف على احتياج ${lead.name} لموقع أو نظام يساعد في تنظيم الشغل. هل مناسب أبعثلك تفاصيل؟`;
    return `https://wa.me/${international}?text=${encodeURIComponent(text)}`;
  }
  function avatar(member, extra = '') { return `<span class="avatar ${extra}" style="background:linear-gradient(145deg,${enc(member?.color || '#304d65')}66,#29314f);color:#e4f6fa">${enc(member?.initials || initials(member?.name))}</span>`; }
  function pageHead(title, subtitle, actions = '') { return `<div class="page-title-row"><div><div class="eyebrow">مساحة العمل / ${enc(title)}</div><h1 class="page-title">${enc(title)}</h1><p class="page-subtitle">${enc(subtitle)}</p></div><div class="title-actions">${actions}</div></div>`; }
  function toast(message) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = message; $('#toastStack').append(t); setTimeout(() => t.remove(), 2900); }
  function addActivity(kind, title, detail, leadId = '', userId = currentUser?.id) { state.activities.unshift({ id: crypto.randomUUID?.() || String(Date.now() + Math.random()), kind, title, detail, leadId, userId, at: new Date().toISOString() }); if (state.activities.length > 500) state.activities.length = 500; }
  function loginScreen() {
    const serverFields = setupRequired
      ? `<div class="eyebrow">إعداد أول مرة · الحساب ده للمالك</div><h1>أنشئ حساب المدير.</h1><p>اختار اسم مستخدم وكلمة مرور خاصة بيك. بعد الدخول تقدر تعمل حسابًا منفصلًا لكل فرد من السيلز.</p><label class="form-label">اسمك</label><input class="field" name="name" required autocomplete="name" placeholder="محمد"><label class="form-label">اسم المستخدم</label><input class="field" name="username" required minlength="3" autocomplete="username" placeholder="mohamed"><label class="form-label">كلمة المرور الخاصة بيك</label><input class="field" name="password" required minlength="12" type="password" autocomplete="new-password" placeholder="١٢ حرفًا على الأقل">`
      : registerMode
        ? `<div class="eyebrow">طلب انضمام لفريق السيلز</div><h1>أنشئ حسابك.</h1><p>اكتب بياناتك. المدير هيراجع الطلب، والحساب مش هيفتح غير بعد الموافقة.</p><label class="form-label">اسمك</label><input class="field" name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="اسمك بالكامل"><label class="form-label">اسم المستخدم</label><input class="field" name="username" required minlength="3" maxlength="48" autocomplete="username" placeholder="اسم تستخدمه للدخول"><label class="form-label">كلمة المرور</label><input class="field" name="password" required minlength="12" maxlength="256" type="password" autocomplete="new-password" placeholder="١٢ حرفًا على الأقل">`
      : `<div class="eyebrow">تسجيل دخول آمن</div><h1>أهلًا بيك في مَدار.</h1><p>ادخل باسم المستخدم وكلمة المرور الخاصة بحسابك.</p><label class="form-label">اسم المستخدم</label><input class="field" name="username" required autocomplete="username" placeholder="اسم المستخدم"><label class="form-label">كلمة المرور</label><input class="field" name="password" required type="password" autocomplete="current-password" placeholder="كلمة المرور">`;
    const localFields = `<div class="eyebrow">نسخة العرض المحلية</div><h1>شغلك كله، على مدارك.</h1><p>سجّل دخولك للوحة الفريق وتابع العملاء والفرص وحركة الشغل اليومية.</p><label class="form-label" for="loginEmail">حساب الفريق</label><select class="field" id="loginEmail">${state.team.map(u => `<option value="${enc(u.email)}">${enc(u.name)} — ${enc(u.role)}</option>`).join('')}</select><label class="form-label" for="loginPassword">كلمة المرور التجريبية</label><input class="field" id="loginPassword" type="password" placeholder="كلمة مرور العرض" value="123456" autocomplete="current-password"><div class="demo-hint">كلمة مرور العرض الموحدة 123456. افتح نسخة الخادم باستخدام run-madar.bat لإنشاء حسابات حقيقية.</div>`;
    login.innerHTML = `<div class="login-visual"><div class="login-art"><div class="orbit o1"></div><div class="orbit o2"></div><div class="glass-board"><div class="glass-top"><span>نبض الشغل</span><i></i></div><div class="glass-chart"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="glass-bottom"><span>فرص الفريق</span><b>${fmt(state.leads.length)} عميل</b></div></div><div class="floating-chip a"><b><i class="chip-dot"></i>الفريق متابع</b><small>${fmt(state.activities.length)} نشاط متسجل</small></div><div class="floating-chip b"><b>كل الفرص في مكان واحد</b><small>عملاء · عروض · مشاريع</small></div></div></div><div class="login-panel"><form class="login-box" id="loginForm"><div class="brand-lockup"><div class="brand-mark"><span>م</span><i></i></div><div><b>مَدار</b><small>مساحة التشغيل</small></div></div>${apiMode ? serverFields : localFields}<button class="btn btn-primary" type="submit">${apiMode && setupRequired ? 'إنشاء حساب المدير' : apiMode && registerMode ? 'إرسال طلب التسجيل' : 'دخول لمساحة العمل'} <span>←</span></button>${apiMode && !setupRequired ? `<button class="text-link" type="button" data-action="toggle-auth">${registerMode ? 'عندك حساب؟ سجّل الدخول' : 'سيلز جديد؟ اطلب إنشاء حساب'}</button>` : ''}${apiMode ? '<div class="demo-hint">الحسابات تُدار من الخادم. كلمة المرور لا تظهر لباقي أعضاء الفريق.</div>' : ''}</form></div>`;
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (apiMode) {
        const form = new FormData(e.currentTarget); const path = setupRequired ? '/api/setup' : registerMode ? '/api/register' : '/api/login';
        try {
          const result = await apiRequest(path, { method: 'POST', body: JSON.stringify({ name: form.get('name'), username: form.get('username'), password: form.get('password') }) });
          if (registerMode && !setupRequired) { registerMode = false; loginScreen(); toast('طلبك وصل للمدير. هتقدر تدخل بعد الموافقة.'); return; }
          await loadApiState(result.user); setupRequired = false; enterApp();
        }
        catch (error) { toast(error.message); }
        return;
      }
      const account = $('#loginEmail').value; const pass = $('#loginPassword').value; const member = state.team.find(p => p.email === account);
      if (!member || member.password !== pass) return toast('بيانات الدخول غير صحيحة'); currentUser = member; sessionStorage.setItem('madar_user', member.id); enterApp();
    });
  }
  function enterApp() {
    login.classList.add('hidden'); shell.classList.remove('hidden');
    const p = currentUser; $('#profileMini').innerHTML = `${avatar(p)}<div><strong>${enc(p.name)}</strong><small>${enc(p.role)}</small></div><button id="logoutBtn" title="خروج">↪</button>`;
    $('#topAvatar').textContent = p.initials || initials(p.name); $('#leadBadge').textContent = fmt(visibleLeads().length);
    $('#logoutBtn').onclick = logout;
    $$('[data-route="settings"]').forEach(el => el.classList.remove('hidden'));
    $('.demo-banner').querySelector('span:nth-child(2)').textContent = apiMode
      ? 'حسابات منفصلة متصلة بخادم مَدار. كلمات المرور لا تظهر لباقي أعضاء الفريق.'
      : 'نسخة تجريبية — البيانات محفوظة على هذا الجهاز فقط. الحسابات هنا للعرض وليست تسجيل دخول آمنًا.';
    if (state.banner) $('.demo-banner').classList.remove('hidden'); else $('.demo-banner').classList.add('hidden');
    $('.footer span:last-child').innerHTML = apiMode ? 'متصل بالخادم <i></i>' : 'نسخة عرض محلية <i></i>';
    render();
  }
  async function logout() { if (apiMode) { try { await apiRequest('/api/logout', { method: 'POST' }); } catch {} } currentUser = null; sessionStorage.removeItem('madar_user'); shell.classList.add('hidden'); login.classList.remove('hidden'); loginScreen(); }
  function setRoute(route) { if (!ROUTES[route]) return; currentRoute = route; $('#sidebar').classList.remove('open'); $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route)); $('#crumbName').textContent = ROUTES[route]; render(); }
  function render() { $('#leadBadge').textContent = fmt(visibleLeads().length); ({ overview: renderOverview, leads: renderLeads, team: renderTeam, offers: renderOffers, projects: renderProjects, reports: renderReports, settings: renderSettings }[currentRoute] || renderOverview)(); }

  function renderOverview() {
    const leads = visibleLeads(), acts = shownActivities(), won = leads.filter(l => l.status === 'عميل حالي').length;
    const open = leads.filter(l => !['عميل حالي', 'غير مهتم'].includes(l.status)).length;
    const touchCount = acts.filter(a => a.kind === 'contact').length;
    const wonValue = state.offers.filter(o => o.status === 'مقفول' && (currentUser.role === 'المدير' || o.owner === currentUser.id)).reduce((s, o) => s + Number(o.value || 0), 0);
    const targetPct = Math.min(100, state.target ? Math.round(wonValue / state.target * 100) : 0);
    const day = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const stages = ['جديد', 'تم التواصل', 'مهتم', 'عرض سعر']; const colors = ['#5c708c', '#55c5dc', '#a78bfa', '#efc46d'];
    const sums = stages.map(s => leads.filter(l => l.status === s).length); const totalStages = Math.max(1, sums.reduce((a, b) => a + b, 0));
    const latest = [...leads].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 6);
    const activityRows = acts.slice(0, 5).map(a => `<div class="activity-row"><span class="activity-symbol">${a.kind === 'contact' ? '↗' : a.kind === 'status' ? '◉' : '✦'}</span><div><b>${enc(a.title)}</b><small>${enc(a.detail)}</small></div><span class="activity-time">${dayLabel(a.at?.slice(0, 10))}</span></div>`).join('') || `<div class="empty-state">لسه مفيش نشاط متسجل. ابدأ بتسجيل أول تواصل مع عميل.</div>`;
    const sellers = state.team.filter(x => x.role === 'سيلز').map(s => { const mine = state.leads.filter(l => l.owner === s.id); const contacted = state.activities.filter(a => a.userId === s.id && a.kind === 'contact').length; return { ...s, n: mine.length, contacted, won: mine.filter(l => l.status === 'عميل حالي').length }; }).sort((a, b) => b.contacted - a.contacted).slice(0, 4);
    content.innerHTML = `${pageHead('نظرة عامة', 'متابعة سريعة لحركة العملاء والفريق والصفقات.', `${currentUser.role === 'المدير' ? '<button class="btn btn-quiet" data-action="import">⇧ استيراد قاعدة العملاء</button>' : ''}<button class="btn btn-primary" data-action="new-lead">＋ عميل جديد</button>`)}
      <div class="hero-card"><div class="hero-content"><div class="hero-date">${enc(day)} · مساحة شغلك جاهزة</div><h2>أهلًا يا <span>${enc(currentUser.name)}</span> 👋</h2><p>عندك ${fmt(open)} فرصة مفتوحة. ابدأ بالمتابعات الأقرب، وكل خطوة هتفضل متسجلة لفريقك.</p></div><div class="hero-metric"><strong>${fmt(won)}</strong><small>عميل حالي</small></div></div>
      <div class="kpi-grid"><div class="kpi-card"><div class="kpi-head">إجمالي العملاء <span class="kpi-icon">◎</span></div><div class="kpi-value">${fmt(leads.length)} <small>في قاعدة البيانات</small></div><div class="kpi-foot">سجلات ظاهرة حسب صلاحية حسابك</div></div><div class="kpi-card"><div class="kpi-head">فرص مفتوحة <span class="kpi-icon" style="color:var(--blue);background:#5a9cff17">↗</span></div><div class="kpi-value">${fmt(open)} <small>محتاجين متابعة</small></div><div class="kpi-foot">العملاء الحاليون وغير المناسبين مستبعدين</div></div><div class="kpi-card"><div class="kpi-head">تواصلات مسجلة <span class="kpi-icon" style="color:var(--violet);background:#a78bfa17">◷</span></div><div class="kpi-value">${fmt(touchCount)} <small>تواصل</small></div><div class="kpi-foot">إجمالي النشاط المسجل لحسابك</div></div><div class="kpi-card"><div class="kpi-head">قيمة الصفقات المقفولة <span class="kpi-icon" style="color:var(--amber);background:#f5bd6217">◇</span></div><div class="kpi-value" style="font-size:17px">${money(wonValue)}</div><div class="kpi-foot">من العروض المسجلة كصفقات مقفولة</div></div></div>
      <div class="dashboard-grid"><div class="panel"><div class="panel-head"><div><div class="panel-title">مسار الفرص</div><div class="panel-caption">شوف العملاء واقفين فين في رحلة البيع</div></div><button class="text-link" data-route="leads">عرض العملاء ←</button></div><div class="pipeline-stats"><div class="pipeline-total"><strong>${fmt(leads.length)}</strong><small>عميل في المسار</small></div><div class="pipeline-delta">${fmt(won)} صفقة حالية</div></div><div class="pipeline-bar">${sums.map((x, i) => `<span style="width:${x / totalStages * 100}%;background:${colors[i]}"></span>`).join('')}</div><div class="pipeline-legend">${stages.map((s, i) => `<div class="legend-item"><i class="legend-dot" style="background:${colors[i]}"></i><div>${enc(s)}<strong>${fmt(sums[i])}</strong></div></div>`).join('')}</div></div>
      <div class="panel"><div class="panel-head"><div><div class="panel-title">هدف الإيرادات</div><div class="panel-caption">الصفقات المقفولة مقابل الهدف</div></div><button class="text-link" data-route="offers">العروض ←</button></div><div class="target-wrap"><div class="ring" style="--progress:${targetPct}%"><span>${fmt(targetPct)}%<small>من الهدف</small></span></div><div class="target-info"><b>${money(wonValue)} محقق</b><p>الهدف الحالي ${money(state.target)}. حدّثه من الإعدادات حسب خطتك.</p><strong>${money(Math.max(0, state.target - wonValue))} متبقي</strong></div></div></div></div>
      <div class="dashboard-grid"><div class="panel table-panel"><div class="panel-head"><div><div class="panel-title">آخر العملاء</div><div class="panel-caption">أحدث السجلات في قاعدة البيانات</div></div><button class="text-link" data-route="leads">كل العملاء ←</button></div>${leadsTable(latest, false)}</div><div class="panel"><div class="panel-head"><div><div class="panel-title">نشاط الفريق</div><div class="panel-caption">آخر التحديثات المسجلة</div></div><button class="text-link" data-route="reports">التقارير ←</button></div><div class="activity-list">${activityRows}</div></div></div>
      <div class="panel"><div class="panel-head"><div><div class="panel-title">حركة فريق السيلز</div><div class="panel-caption">الأرقام من النشاط المسجل داخل النظام</div></div><button class="text-link" data-route="team">صفحة الفريق ←</button></div><div class="seller-list">${sellers.map(s => `<div class="seller-row">${avatar(s)}<div><div class="seller-name">${enc(s.name)}</div><div class="seller-meta">${fmt(s.n)} عميل · ${fmt(s.contacted)} تواصل مسجل</div><div class="seller-meter"><i style="width:${Math.min(100, s.contacted * 10)}%"></i></div></div><div class="seller-score"><b>${fmt(s.won)}</b><small>صفقات</small></div></div>`).join('') || '<div class="empty-state">أضف أفراد السيلز لبدء متابعة الأداء.</div>'}</div></div>`;
  }

  function leadsTable(items, showOwner = true) {
    if (!items.length) return `<div class="empty-state">مفيش عملاء مطابقين. جرّب تغيّر البحث أو الفلاتر.</div>`;
    return `<div class="table-wrap"><table><thead><tr><th>النشاط</th><th>القطاع</th><th>التليفون</th>${showOwner ? '<th>المسؤول</th>' : ''}<th>الحالة</th><th>إجراء</th></tr></thead><tbody>${items.map(l => `<tr><td><div class="business-cell"><span class="business-logo">${enc(initials(l.name))}</span><div><b>${enc(l.name)}</b><small>${enc(l.address || 'مفيش عنوان مسجل')}</small></div></div></td><td>${enc(l.sector || '—')}</td><td>${enc(l.phones || '—')}</td>${showOwner ? `<td><label class="owner-cell">${ownerControl(l)}</label></td>` : ''}<td>${currentUser.role === 'سيلز' && !l.owner ? '<span class="panel-caption">استلم العميل الأول</span>' : `<select class="mini-select status-select" data-id="${enc(l.id)}">${STATUSES.map(s => `<option ${s === l.status ? 'selected' : ''}>${enc(s)}</option>`).join('')}</select>`}</td><td><button class="text-link" data-action="view-lead" data-id="${enc(l.id)}">فتح التفاصيل</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function ownerControl(lead) {
    if (currentUser.role !== 'المدير') return lead.owner === currentUser.id ? `${avatar(userById(lead.owner), 'small-avatar')}<span>${enc(ownerName(lead.owner))}</span>` : `<button class="btn btn-primary claim-btn" data-action="claim-lead" data-id="${enc(lead.id)}">استلم العميل</button>`;
    return `<select class="mini-select owner-select" data-id="${enc(lead.id)}"><option value="">غير مُعيّن</option>${state.team.filter(m => m.role === 'سيلز').map(m => `<option value="${enc(m.id)}" ${lead.owner === m.id ? 'selected' : ''}>${enc(m.name)}</option>`).join('')}</select>`;
  }
  function renderLeads() {
    const all = visibleLeads(); const sectorOptions = [...new Set(all.map(l => l.sector).filter(Boolean))].sort();
    content.innerHTML = `${pageHead('العملاء والفرص', `${fmt(all.length)} نشاط متاح لك. استلم العميل غير المعيّن ليبقى ضمن قائمتك وحدك.`, `${currentUser.role === 'المدير' ? '<button class="btn btn-quiet" data-action="import">⇧ استيراد CSV</button>' : ''}<button class="btn btn-primary" data-action="new-lead">＋ عميل جديد</button>`)}<div class="filter-bar"><input class="filter-search" id="leadSearch" placeholder="ابحث بالاسم أو التليفون أو المنطقة" value="${enc(leadFilter)}"><select id="statusFilter" class="mini-select"><option value="">كل الحالات</option>${STATUSES.map(s => `<option>${enc(s)}</option>`).join('')}</select><select id="sectorFilter" class="mini-select"><option value="">كل القطاعات</option>${sectorOptions.map(s => `<option>${enc(s)}</option>`).join('')}</select><select id="ownerFilter" class="mini-select"><option value="">كل المسؤولين</option><option value="__unassigned">غير مُعيّن</option>${state.team.filter(m => m.role === 'سيلز').map(m => `<option value="${enc(m.id)}">${enc(m.name)}</option>`).join('')}</select><button class="btn btn-quiet" data-action="export-csv">↓ تصدير</button></div><div class="panel table-panel" id="leadsTablePanel"></div>`;
    const updateTable = () => { const q = $('#leadSearch').value.trim().toLocaleLowerCase(); leadFilter = $('#leadSearch').value; const st = $('#statusFilter').value, sector = $('#sectorFilter').value, owner = $('#ownerFilter').value; const filtered = all.filter(l => (!q || [l.name, l.phones, l.address, l.sector].join(' ').toLocaleLowerCase().includes(q)) && (!st || l.status === st) && (!sector || l.sector === sector) && (!owner || (owner === '__unassigned' ? !l.owner : l.owner === owner))); $('#leadsTablePanel').innerHTML = `<div class="panel-head"><div><div class="panel-title">كل السجلات</div><div class="panel-caption">${fmt(filtered.length)} نتيجة ظاهرة</div></div><span class="panel-caption">${currentUser.role === 'سيلز' ? 'استلم عميلًا غير معيّن لربطه بحسابك' : 'اضغط على الحالة لتحديثها مباشرة'}</span></div>${leadsTable(filtered, true)}`; };
    ['#leadSearch', '#statusFilter', '#sectorFilter', '#ownerFilter'].forEach(sel => $(sel).addEventListener(sel === '#leadSearch' ? 'input' : 'change', updateTable)); updateTable();
  }
  function renderTeam() {
    const team = state.team.filter(m => currentUser.role === 'المدير' ? m.approved !== false : m.id === currentUser.id);
    const managed = currentUser.role === 'المدير'; const scopeLeads = managed ? state.leads : leads; const scopeActs = managed ? state.activities : state.activities.filter(a => a.userId === currentUser.id);
    const pending = managed && apiMode ? state.team.filter(m => m.role === 'سيلز' && m.approved === false) : [];
    content.innerHTML = `${pageHead('فريق السيلز', 'اعرف توزيع العملاء وحركة المتابعة لكل فرد من الفريق.', managed ? '<button class="btn btn-primary" data-action="new-member">＋ إضافة عضو</button>' : '')}${pending.length ? `<div class="panel table-panel"><div class="panel-head"><div><div class="panel-title">طلبات انضمام في انتظارك</div><div class="panel-caption">الحسابات دي مش هتقدر تدخل قبل موافقتك</div></div><b>${fmt(pending.length)} طلب</b></div><div class="team-grid">${pending.map(m => `<div class="team-card"><div class="team-person">${avatar(m)}<div><b>${enc(m.name)}</b><small>${enc(m.username)}</small></div></div><div class="team-actions"><button class="btn btn-primary" data-action="approve-member" data-id="${enc(m.id)}">موافقة</button><button class="btn btn-quiet" data-action="reject-member" data-id="${enc(m.id)}">رفض</button></div></div>`).join('')}</div></div>` : ''}<div class="kpi-grid"><div class="kpi-card"><div class="kpi-head">${managed ? 'أفراد السيلز' : 'عملائي'} <span class="kpi-icon">♧</span></div><div class="kpi-value">${fmt(managed ? state.team.filter(m => m.role === 'سيلز' && m.approved !== false).length : scopeLeads.filter(l => l.owner === currentUser.id).length)} <small>${managed ? 'عضو' : 'عميل'}</small></div><div class="kpi-foot">${managed ? 'لكل عضو مساحة متابعة خاصة' : 'العملاء اللي استلمتهم'}</div></div><div class="kpi-card"><div class="kpi-head">${managed ? 'عملاء غير موزعين' : 'فرصي المفتوحة'} <span class="kpi-icon" style="color:var(--amber)">◎</span></div><div class="kpi-value">${fmt(managed ? state.leads.filter(l => !l.owner).length : scopeLeads.filter(l => !['عميل حالي', 'غير مهتم'].includes(l.status)).length)}</div><div class="kpi-foot">${managed ? 'متاحين للاستلام أو التوزيع' : 'من العملاء اللي استلمتهم'}</div></div><div class="kpi-card"><div class="kpi-head">تواصلات مسجلة <span class="kpi-icon" style="color:var(--violet)">↗</span></div><div class="kpi-value">${fmt(scopeActs.filter(a => a.kind === 'contact').length)}</div><div class="kpi-foot">من سجل الأنشطة</div></div><div class="kpi-card"><div class="kpi-head">صفقات حالية <span class="kpi-icon" style="color:var(--green)">✦</span></div><div class="kpi-value">${fmt(scopeLeads.filter(l => l.status === 'عميل حالي').length)}</div><div class="kpi-foot">عملاء تم إغلاقهم كصفقات</div></div></div><div class="team-grid">${team.map(m => { const theirs = state.leads.filter(l => l.owner === m.id); const calls = state.activities.filter(a => a.userId === m.id && a.kind === 'contact').length; const deals = theirs.filter(l => l.status === 'عميل حالي').length; const offers = state.offers.filter(o => o.owner === m.id && o.status === 'مقفول').reduce((n, o) => n + Number(o.value || 0), 0); return `<div class="team-card"><div class="team-person">${avatar(m)}<div><b>${enc(m.name)}</b><small>${enc(m.role)} · ${enc(m.username || m.email)}</small></div></div><div class="team-stats"><div><strong>${fmt(theirs.length)}</strong><small>عملاء</small></div><div><strong>${fmt(calls)}</strong><small>تواصلات</small></div><div><strong>${fmt(deals)}</strong><small>صفقات</small></div></div><div class="settings-row" style="font-size:8px"><span>إيرادات مقفولة</span><b style="color:var(--cyan)">${money(offers)}</b></div>${managed && m.role === 'سيلز' ? `<button class="btn btn-quiet" data-action="remove-member" data-id="${enc(m.id)}">إيقاف الحساب</button>` : ''}</div>`; }).join('')}</div>`;
  }
  function renderOffers() {
    const offers = state.offers.filter(o => currentUser.role === 'المدير' || o.owner === currentUser.id);
    const total = offers.reduce((s, o) => s + Number(o.value || 0), 0); const closed = offers.filter(o => o.status === 'مقفول').reduce((s, o) => s + Number(o.value || 0), 0);
    content.innerHTML = `${pageHead('العروض والصفقات', 'سجّل عروض الأسعار وقيمة الفرص وتابعها لحد ما تتقفل.', '<button class="btn btn-primary" data-action="new-offer">＋ عرض سعر جديد</button>')}<div class="kpi-grid"><div class="kpi-card"><div class="kpi-head">عدد العروض <span class="kpi-icon">▤</span></div><div class="kpi-value">${fmt(offers.length)}</div><div class="kpi-foot">عرض مسجل</div></div><div class="kpi-card"><div class="kpi-head">إجمالي قيمة العروض <span class="kpi-icon" style="color:var(--blue)">◇</span></div><div class="kpi-value" style="font-size:17px">${money(total)}</div><div class="kpi-foot">كل الحالات</div></div><div class="kpi-card"><div class="kpi-head">صفقات مقفولة <span class="kpi-icon" style="color:var(--green)">✦</span></div><div class="kpi-value" style="font-size:17px">${money(closed)}</div><div class="kpi-foot">قيمة مؤكدة في السجل</div></div><div class="kpi-card"><div class="kpi-head">تحتاج متابعة <span class="kpi-icon" style="color:var(--amber)">◷</span></div><div class="kpi-value">${fmt(offers.filter(o => o.status !== 'مقفول' && o.status !== 'مرفوض').length)}</div><div class="kpi-foot">عروض مفتوحة</div></div></div><div class="panel table-panel"><div class="panel-head"><div><div class="panel-title">سجل العروض</div><div class="panel-caption">${fmt(offers.length)} عرض</div></div></div>${offers.length ? `<div class="table-wrap"><table><thead><tr><th>العميل</th><th>الخدمة</th><th>القيمة</th><th>المسؤول</th><th>الحالة</th><th>تاريخ الإنشاء</th></tr></thead><tbody>${offers.map(o => `<tr><td>${enc(state.leads.find(l => l.id === o.leadId)?.name || o.customer || '—')}</td><td>${enc(o.service)}</td><td>${money(o.value)}</td><td>${enc(ownerName(o.owner))}</td><td><select class="mini-select offer-status" data-id="${enc(o.id)}">${['مسودة', 'مرسل', 'تفاوض', 'مقفول', 'مرفوض'].map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td>${dayLabel(o.date)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">لسه مفيش عروض مسجلة. أضف أول عرض عشان تتابع قيمته وقرار العميل.</div>'}</div>`;
  }
  function renderProjects() {
    const projects = state.projects.filter(p => currentUser.role === 'المدير' || p.owner === currentUser.id);
    content.innerHTML = `${pageHead('المشاريع', 'تابع التنفيذ والتسليمات بعد ما الصفقة تتحول لشغل.', '<button class="btn btn-primary" data-action="new-project">＋ مشروع جديد</button>')}<div class="kpi-grid"><div class="kpi-card"><div class="kpi-head">مشاريع مفتوحة <span class="kpi-icon">▦</span></div><div class="kpi-value">${fmt(projects.filter(p => p.status !== 'تم التسليم').length)}</div><div class="kpi-foot">محتاجة متابعة تنفيذ</div></div><div class="kpi-card"><div class="kpi-head">تم التسليم <span class="kpi-icon" style="color:var(--green)">✓</span></div><div class="kpi-value">${fmt(projects.filter(p => p.status === 'تم التسليم').length)}</div><div class="kpi-foot">مشاريع مكتملة</div></div><div class="kpi-card"><div class="kpi-head">قيمة المشاريع <span class="kpi-icon" style="color:var(--amber)">◇</span></div><div class="kpi-value" style="font-size:17px">${money(projects.reduce((s, p) => s + Number(p.value || 0), 0))}</div><div class="kpi-foot">قيمة مسجلة للمشاريع</div></div><div class="kpi-card"><div class="kpi-head">المسؤول عن التنفيذ <span class="kpi-icon" style="color:var(--violet)">♧</span></div><div class="kpi-value">${fmt(new Set(projects.map(p => p.owner).filter(Boolean)).size)}</div><div class="kpi-foot">أعضاء عليهم مشاريع</div></div></div><div class="panel table-panel"><div class="panel-head"><div><div class="panel-title">لوحة المشاريع</div><div class="panel-caption">حوّل الاتفاقات لمهام ومواعيد تسليم واضحة</div></div></div>${projects.length ? `<div class="table-wrap"><table><thead><tr><th>المشروع</th><th>العميل</th><th>المسؤول</th><th>قيمة المشروع</th><th>تاريخ التسليم</th><th>الحالة</th></tr></thead><tbody>${projects.map(p => `<tr><td><b>${enc(p.name)}</b><small style="display:block;color:#8492a4;margin-top:4px">${enc(p.service)}</small></td><td>${enc(p.customer)}</td><td>${enc(ownerName(p.owner))}</td><td>${money(p.value)}</td><td>${dayLabel(p.due)}</td><td><select class="mini-select project-status" data-id="${enc(p.id)}">${['جديد', 'جاري التنفيذ', 'مراجعة', 'تم التسليم', 'متوقف'].map(s => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">لا توجد مشاريع حتى الآن. أضف مشروعًا بعد تأكيد أول صفقة.</div>'}</div>`;
  }
  function renderReports() {
    const leads = visibleLeads(), acts = shownActivities(); const sellers = state.team.filter(m => m.role === 'سيلز' && (currentUser.role === 'المدير' || m.id === currentUser.id));
    const months = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 6 + i); return new Intl.DateTimeFormat('ar-EG', { month: 'short' }).format(d); });
    const base = [38, 48, 42, 63, 58, 76, 92];
    content.innerHTML = `${pageHead('التقارير', 'مؤشرات أداء مبنية على البيانات التي تم تسجيلها داخل مَدار.', '<button class="btn btn-quiet" data-action="export-csv">↓ تصدير العملاء</button>')}<div class="kpi-grid"><div class="kpi-card"><div class="kpi-head">تواصلات مسجلة <span class="kpi-icon">↗</span></div><div class="kpi-value">${fmt(acts.filter(a => a.kind === 'contact').length)}</div><div class="kpi-foot">داخل سجل الأنشطة</div></div><div class="kpi-card"><div class="kpi-head">فرص مهتمة <span class="kpi-icon" style="color:var(--violet)">◎</span></div><div class="kpi-value">${fmt(leads.filter(l => ['مهتم', 'عرض سعر', 'تفاوض'].includes(l.status)).length)}</div><div class="kpi-foot">مهتم أو وصل لمرحلة عرض</div></div><div class="kpi-card"><div class="kpi-head">تحويل لعميل حالي <span class="kpi-icon" style="color:var(--green)">✦</span></div><div class="kpi-value">${fmt(leads.filter(l => l.status === 'عميل حالي').length)}</div><div class="kpi-foot">من العملاء الظاهرين لحسابك</div></div><div class="kpi-card"><div class="kpi-head">عروض مقفولة <span class="kpi-icon" style="color:var(--amber)">◇</span></div><div class="kpi-value">${fmt(state.offers.filter(o => o.status === 'مقفول' && (currentUser.role === 'المدير' || o.owner === currentUser.id)).length)}</div><div class="kpi-foot">مسجلة كصفقات ناجحة</div></div></div><div class="dashboard-grid"><div class="panel"><div class="panel-head"><div><div class="panel-title">نظرة على الحركة</div><div class="panel-caption">رسم توضيحي — ربط الرسم بالتقويم يتطلب إعداد التقرير</div></div></div><div class="report-bars">${months.map((m, i) => `<div class="report-col"><i style="height:${base[i]}%"></i><i style="height:${Math.max(12, base[i] - 16)}%"></i><span>${enc(m)}</span></div>`).join('')}</div><div class="pipeline-legend"><div class="legend-item"><i class="legend-dot" style="background:#61d8c8"></i><div>فرص جديدة<strong>${fmt(leads.filter(l => l.status === 'جديد').length)}</strong></div></div><div class="legend-item"><i class="legend-dot" style="background:#a78bfa"></i><div>تواصل مسجل<strong>${fmt(acts.filter(a => a.kind === 'contact').length)}</strong></div></div></div></div><div class="panel"><div class="panel-head"><div><div class="panel-title">ملخص الفريق</div><div class="panel-caption">نشاط السيلز والنتائج</div></div></div><div class="seller-list">${sellers.map(m => { const my = state.leads.filter(l => l.owner === m.id); const c = state.activities.filter(a => a.userId === m.id && a.kind === 'contact').length; const w = my.filter(l => l.status === 'عميل حالي').length; return `<div class="seller-row">${avatar(m)}<div><div class="seller-name">${enc(m.name)}</div><div class="seller-meta">${fmt(my.length)} عميل · ${fmt(c)} تواصل</div><div class="seller-meter"><i style="width:${Math.min(100, c * 10)}%"></i></div></div><div class="seller-score"><b>${fmt(w)}</b><small>صفقات</small></div></div>`; }).join('')}</div></div></div><div class="panel table-panel"><div class="panel-head"><div><div class="panel-title">آخر النشاط</div><div class="panel-caption">${fmt(acts.length)} نشاط مسجل</div></div></div>${acts.length ? `<div class="table-wrap"><table><thead><tr><th>النشاط</th><th>التفاصيل</th><th>العضو</th><th>التاريخ</th></tr></thead><tbody>${acts.slice(0, 20).map(a => `<tr><td>${enc(a.title)}</td><td>${enc(a.detail)}</td><td>${enc(ownerName(a.userId))}</td><td>${dayLabel(a.at?.slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">أول ما الفريق يسجل تواصل أو تحديث، هتظهر الحركة هنا.</div>'}</div>`;
  }
  function renderSettings() {
    const manager = currentUser.role === 'المدير';
    const managerPanel = manager ? `<div class="panel"><div class="panel-head"><div><div class="panel-title">هدف الإيرادات الشهري</div><div class="panel-caption">يظهر في لوحة المتابعة الرئيسية</div></div></div><label class="form-label">الهدف بالجنيه المصري</label><input id="targetInput" class="field" type="number" min="0" value="${Number(state.target)}"><div class="settings-row"><span>أعضاء السيلز</span><b>${fmt(state.team.filter(m => m.role === 'سيلز').length)} أعضاء</b></div><div class="settings-row"><span>إدارة الحسابات</span><b>من صفحة فريق السيلز</b></div></div><div class="panel"><div class="panel-head"><div><div class="panel-title">إدارة العملاء</div><div class="panel-caption">استيراد قاعدة العملاء أو تصدير نسخة منها</div></div></div><button class="btn" data-action="import">⇧ استيراد ملف CSV للعملاء</button> <button class="btn" data-action="export-csv">↓ تنزيل العملاء CSV</button><div class="settings-row"><div><b>تخزين البيانات</b><small>${apiMode ? 'قاعدة بيانات محفوظة على الخادم' : 'محفوظة محليًا في المتصفح'}</small></div><span class="status-pill">${apiMode ? 'خادم' : 'محلي'}</span></div></div>` : `<div class="panel"><div class="panel-head"><div><div class="panel-title">مساحة حسابك</div><div class="panel-caption">العملاء والتحديثات المرتبطة بحسابك</div></div></div><div class="settings-row"><span>اسم المستخدم</span><b>${enc(currentUser.username || currentUser.email)}</b></div><div class="settings-row"><span>الصلاحية</span><b>${enc(currentUser.role)}</b></div></div>`;
    content.innerHTML = `${pageHead('الإعدادات', 'إدارة حسابك ومساحة العمل.', manager ? '<button class="btn btn-primary" data-action="save-target">حفظ الهدف</button>' : '')}<div class="view-grid"><div class="panel"><div class="panel-head"><div><div class="panel-title">حسابك الشخصي</div><div class="panel-caption">بيانات دخول منفصلة لكل عضو</div></div></div><div class="settings-row"><span>اسم الحساب</span><b>${enc(currentUser.name)}</b></div><div class="settings-row"><span>اسم المستخدم</span><b>${enc(currentUser.username || currentUser.email)}</b></div><div class="settings-row"><span>نوع الحساب</span><b>${enc(currentUser.role)}</b></div><button class="btn btn-primary" style="margin-top:13px" data-action="change-password">تغيير كلمة المرور</button></div>${managerPanel}<div class="panel"><div class="panel-head"><div><div class="panel-title">جلسة آمنة</div><div class="panel-caption">${apiMode ? 'تسجيل دخول من الخادم' : 'نسخة العرض المحلية'}</div></div></div><div class="settings-row"><div><b>صلاحيات الحساب</b><small>${manager ? 'مدير مساحة العمل' : 'سيلز — تظهر لك العملاء المسندة لك والمتاحة للاستلام'}</small></div><span class="status-pill">${apiMode ? 'مفعّل' : 'عرض'}</span></div><div style="margin-top:12px;color:#9daab9;font-size:8px;line-height:2">${apiMode ? 'كلمة المرور لا تظهر لباقي الأعضاء، ويُسمح بتغييرها من هنا.' : 'في نسخة العرض، كلمات المرور محلية وغير مناسبة لحسابات فعلية. شغّل الخادم لإنشاء حسابات الفريق.'}</div></div></div>`;
  }

  function openModal(title, body, onSave, saveLabel = 'حفظ') {
    modalRoot.innerHTML = `<div class="modal-backdrop"><form class="modal" id="modalForm"><div class="modal-head"><h3>${enc(title)}</h3><button type="button" class="modal-close" aria-label="إغلاق">×</button></div><div class="modal-body">${body}</div><div class="modal-actions"><button class="btn btn-primary" type="submit">${enc(saveLabel)}</button><button class="btn btn-quiet" type="button" data-cancel>إلغاء</button></div></form></div>`;
    $('.modal-close').onclick = closeModal; $('[data-cancel]').onclick = closeModal;
    $('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
    $('#modalForm').addEventListener('submit', e => {
      e.preventDefault();
      try {
        const result = onSave(new FormData(e.currentTarget));
        if (result && typeof result.then === 'function') result.then(value => { if (value !== false) closeModal(); }).catch(error => toast(error.message || 'تعذر حفظ البيانات'));
        else if (result !== false) closeModal();
      } catch (error) { toast(error.message || 'تعذر حفظ البيانات'); }
    });
  }
  function closeModal() { modalRoot.innerHTML = ''; }
  function leadModal(lead = null) {
    const managers = state.team.filter(m => m.role === 'سيلز');
    const body = `<div class="form-grid"><div><label class="form-label">اسم النشاط *</label><input required name="name" class="field" value="${enc(lead?.name || '')}" placeholder="مثال: مطعم أو شركة"></div><div><label class="form-label">القطاع</label><select name="sector" class="field">${SECTORS.map(s => `<option ${lead?.sector === s ? 'selected' : ''}>${enc(s)}</option>`).join('')}</select></div><div class="full"><label class="form-label">رابط واتساب المنشور للنشاط *</label><input required name="whatsapp" type="url" class="field" value="${enc(lead?.whatsapp || '')}" placeholder="https://wa.me/201... أو رابط WhatsApp منشور"><small class="page-subtitle">هنضيف النشاط فقط لما يكون رابط واتساب متاحًا ومنشورًا.</small></div><div><label class="form-label">رقم النشاط المنشور</label><input name="phones" class="field" value="${enc(lead?.phones || '')}" placeholder="رقم منشور للنشاط"></div><div><label class="form-label">المسؤول</label><select name="owner" class="field"><option value="">غير مُعيّن</option>${managers.map(m => `<option value="${enc(m.id)}" ${(lead?.owner || (currentUser.role === 'سيلز' ? currentUser.id : '')) === m.id ? 'selected' : ''}>${enc(m.name)}</option>`).join('')}</select></div><div class="full"><label class="form-label">المنطقة / العنوان</label><input name="address" class="field" value="${enc(lead?.address || '')}" placeholder="المدينة والمنطقة"></div><div class="full"><label class="form-label">ملاحظات</label><textarea name="note" class="field textarea" placeholder="احتياج النشاط أو تفاصيل مهمة">${enc(lead?.note || '')}</textarea></div></div>`;
    openModal(lead ? 'تعديل بيانات النشاط' : 'إضافة عميل جديد', body, form => {
      const name = form.get('name')?.trim(); if (!name) return false;
      const whatsapp = form.get('whatsapp')?.trim(); if (!/(?:wa\.me\/|phone=)\+?\d{10,15}/i.test(whatsapp || '')) { toast('أدخل رابط واتساب منشورًا يحتوي على رقم صحيح'); return false; }
      const phones = `واتساب: +${whatsappDigits(whatsapp)}`;
      if (lead) { Object.assign(lead, { name, sector: form.get('sector'), phones, whatsapp, owner: currentUser.role === 'المدير' ? form.get('owner') : currentUser.id, address: form.get('address'), note: form.get('note') }); addActivity('update', 'تحديث بيانات عميل', name, lead.id); }
      else { const item = { id: `MAD-${Date.now()}`, name, sector: form.get('sector'), phones, whatsapp, owner: currentUser.role === 'المدير' ? form.get('owner') : currentUser.id, address: form.get('address'), note: form.get('note'), status: 'جديد', createdAt: today(), source: '', email: '', website: '', opportunity: '' }; state.leads.unshift(item); addActivity('lead', 'إضافة عميل جديد', name, item.id); }
      save(); render(); toast(lead ? 'تم تحديث بيانات النشاط' : 'العميل اتضاف بنجاح');
    });
  }
  function viewLead(id) {
    const lead = state.leads.find(l => l.id === id); if (!lead) return;
    const phone = safePhone(lead.phones); const wa = whatsappUrl(lead); const activity = state.activities.filter(a => a.leadId === id).slice(0, 6);
    const unclaimed = currentUser.role === 'سيلز' && !lead.owner;
    const canEdit = currentUser.role === 'المدير' || lead.owner === currentUser.id;
    const body = `<div class="business-cell" style="margin-bottom:14px"><span class="business-logo" style="width:38px;height:38px">${enc(initials(lead.name))}</span><div><b>${enc(lead.name)}</b><small>${enc(lead.sector || 'قطاع غير محدد')}</small></div></div><div class="view-grid"><div><label class="form-label">رقم واتساب المنشور</label><div class="settings-row">${enc(lead.phones || `+${whatsappDigits(lead.whatsapp)}`)}</div></div><div><label class="form-label">مسؤول المتابعة</label><div class="settings-row">${enc(ownerName(lead.owner))}</div></div><div><label class="form-label">المنطقة</label><div class="settings-row">${enc(lead.address || 'غير مسجلة')}</div></div><div><label class="form-label">حالة الفرصة</label><div class="settings-row"><span class="status-pill ${statusClass(lead.status)}">${enc(lead.status)}</span></div></div></div><div class="panel" style="margin-top:12px"><div class="panel-title">فرصة برمجية محتملة</div><p class="page-subtitle">${enc(lead.opportunity || 'اسأل عن احتياج النشاط الأول، ثم اقترح حلًا مناسبًا.')}</p></div>${lead.note ? `<p class="page-subtitle">${enc(lead.note)}</p>` : ''}<div class="panel" style="margin-top:12px"><div class="panel-title">سجل التواصل</div><div class="activity-list" style="margin-top:10px">${activity.map(a => `<div class="activity-row"><span class="activity-symbol">${a.kind === 'contact' ? '↗' : '◉'}</span><div><b>${enc(a.title)}</b><small>${enc(a.detail)}</small></div><span class="activity-time">${dayLabel(a.at?.slice(0, 10))}</span></div>`).join('') || '<div class="empty-state" style="padding:16px">مفيش تواصل مسجل لحد دلوقتي.</div>'}</div></div><div class="modal-actions" style="padding:14px 0 0;border:0;justify-content:flex-start">${wa ? `<a class="btn btn-primary" href="${enc(wa)}" target="_blank" rel="noopener">◉ مراسلة واتساب</a>` : ''}${unclaimed ? `<button class="btn btn-primary" type="button" data-action="claim-lead" data-id="${enc(id)}">استلم العميل</button>` : `<button class="btn" type="button" data-action="log-contact" data-id="${enc(id)}">＋ تسجيل تواصل</button>`}${canEdit ? `<button class="btn" type="button" data-action="edit-lead" data-id="${enc(id)}">✎ تعديل</button><button class="btn btn-quiet" type="button" data-action="delete-lead" data-id="${enc(id)}">حذف العميل</button>` : ''}</div>`;
    openModal('تفاصيل العميل', body, () => {} , 'إغلاق');
    $('#modalForm').addEventListener('submit', e => { e.preventDefault(); closeModal(); });
  }
  function contactModal(id) {
    const lead = state.leads.find(l => l.id === id); if (!lead) return;
    const body = `<div class="form-grid"><div><label class="form-label">طريقة التواصل</label><select class="field" name="method"><option>مكالمة</option><option>واتساب</option><option>رسالة</option><option>اجتماع</option></select></div><div><label class="form-label">النتيجة</label><select class="field" name="result"><option>لم يرد</option><option>تم التواصل</option><option>مهتم</option><option>طلب عرض سعر</option><option>متابعة لاحقًا</option><option>غير مهتم</option></select></div><div class="full"><label class="form-label">ملخص المكالمة / الرسالة</label><textarea class="field textarea" name="detail" placeholder="اكتب أهم نقطة اتقالت"></textarea></div><div><label class="form-label">موعد المتابعة القادم</label><input class="field" name="follow" type="date"></div></div>`;
    openModal(`تسجيل تواصل — ${lead.name}`, body, form => {
      const method = form.get('method'), result = form.get('result'), detail = form.get('detail')?.trim() || result;
      addActivity('contact', `تواصل ${method} مع ${lead.name}`, `${result}${detail && detail !== result ? ` · ${detail}` : ''}${form.get('follow') ? ` · متابعة ${form.get('follow')}` : ''}`, id);
      lead.lastContact = today(); lead.followUp = form.get('follow') || ''; const statusMap = { 'تم التواصل': 'تم التواصل', 'مهتم': 'مهتم', 'طلب عرض سعر': 'عرض سعر', 'غير مهتم': 'غير مهتم' }; if (statusMap[result]) lead.status = statusMap[result];
      save(); render(); toast('تم تسجيل التواصل والمتابعة');
    }, 'تسجيل التواصل');
  }
  function offerModal() {
    const available = visibleLeads();
    if (!available.length) return toast('أضف عميلًا أولًا عشان تربط العرض بيه');
    const body = `<div class="form-grid"><div class="full"><label class="form-label">العميل *</label><select required name="lead" class="field">${available.map(l => `<option value="${enc(l.id)}">${enc(l.name)}</option>`).join('')}</select></div><div><label class="form-label">الخدمة</label><input required name="service" class="field" placeholder="موقع / تطبيق / نظام"></div><div><label class="form-label">قيمة العرض بالجنيه</label><input name="value" type="number" min="0" class="field" placeholder="0"></div><div><label class="form-label">الحالة</label><select name="status" class="field">${['مسودة', 'مرسل', 'تفاوض', 'مقفول', 'مرفوض'].map(s => `<option>${s}</option>`).join('')}</select></div><div><label class="form-label">موعد قرار متوقع</label><input name="due" type="date" class="field"></div></div>`;
    openModal('إنشاء عرض سعر', body, form => {
      const lead = state.leads.find(l => l.id === form.get('lead')); const offer = { id: `O-${Date.now()}`, leadId: lead.id, service: form.get('service').trim(), value: Number(form.get('value') || 0), status: form.get('status'), due: form.get('due'), owner: currentUser.role === 'سيلز' ? currentUser.id : lead.owner, date: today() };
      state.offers.unshift(offer); lead.status = offer.status === 'مقفول' ? 'عميل حالي' : 'عرض سعر'; addActivity('offer', 'إضافة عرض سعر', `${lead.name} · ${offer.service} · ${money(offer.value)}`, lead.id); save(); render(); toast('تم حفظ عرض السعر');
    }, 'حفظ العرض');
  }
  function projectModal() {
    const leads = visibleLeads().filter(l => l.status === 'عميل حالي');
    const body = `<div class="form-grid"><div><label class="form-label">اسم المشروع *</label><input name="name" required class="field" placeholder="اسم واضح للمشروع"></div><div><label class="form-label">العميل</label><select name="lead" class="field"><option value="">اختيار عميل</option>${leads.map(l => `<option value="${enc(l.id)}">${enc(l.name)}</option>`).join('')}</select></div><div><label class="form-label">الخدمة / نطاق الشغل</label><input name="service" class="field" placeholder="المتفق عليه"></div><div><label class="form-label">قيمة المشروع</label><input name="value" type="number" class="field" min="0"></div><div><label class="form-label">موعد التسليم</label><input name="due" type="date" class="field"></div><div><label class="form-label">الحالة</label><select name="status" class="field"><option>جديد</option><option>جاري التنفيذ</option><option>مراجعة</option><option>تم التسليم</option><option>متوقف</option></select></div></div>`;
    openModal('إضافة مشروع', body, form => { const l = state.leads.find(x => x.id === form.get('lead')); const project = { id: `P-${Date.now()}`, name: form.get('name').trim(), customer: l?.name || 'عميل جديد', leadId: l?.id || '', service: form.get('service'), value: Number(form.get('value') || 0), due: form.get('due'), status: form.get('status'), owner: currentUser.role === 'سيلز' ? currentUser.id : l?.owner || currentUser.id }; state.projects.unshift(project); addActivity('project', 'إضافة مشروع', project.name, project.leadId); save(); render(); toast('المشروع اتضاف'); });
  }
  function memberModal() {
    if (currentUser.role !== 'المدير') return;
    const body = `<div class="form-grid"><div><label class="form-label">اسم عضو الفريق *</label><input name="name" required class="field" placeholder="الاسم"></div><div><label class="form-label">اسم المستخدم *</label><input name="username" required minlength="3" class="field" placeholder="مثال: sara.sales"></div><div class="full"><label class="form-label">كلمة مرور خاصة بالعضو *</label><input name="password" required minlength="12" type="password" class="field" placeholder="١٢ حرفًا على الأقل"></div></div><p class="page-subtitle">كل فرد هيكون له اسم مستخدم وكلمة مرور مختلفة. شارك بيانات الدخول مع صاحب الحساب فقط.</p>`;
    openModal('إنشاء حساب سيلز', body, async form => {
      const name = form.get('name').trim(), username = form.get('username').trim().toLowerCase(), password = form.get('password');
      if (password.length < 12) { toast('اكتب كلمة مرور ١٢ حرفًا على الأقل'); return false; }
      if (apiMode) {
        const result = await apiRequest('/api/users', { method: 'POST', body: JSON.stringify({ name, username, password }) });
        state.team.push({ ...result.user, email: result.user.username }); addActivity('team', 'إضافة عضو للفريق', name); save(); render(); toast(`تم إنشاء حساب ${name}`); return true;
      }
      if (state.team.some(m => m.email?.toLowerCase() === username || m.username?.toLowerCase() === username)) { toast('اسم المستخدم مستخدم بالفعل'); return false; }
      const member = { id: `sales-${Date.now()}`, name, username, email: username, role: 'سيلز', initials: initials(name), color: ['#58d6a3', '#a78bfa', '#64a7ff', '#f1a978'][state.team.length % 4], password };
      state.team.push(member); addActivity('team', 'إضافة عضو للفريق', name); save(); render(); toast('تمت إضافة حساب سيلز'); return true;
    }, 'إنشاء الحساب');
  }

  function passwordModal() {
    if (!apiMode) return toast('تغيير كلمة المرور متاح بعد تشغيل نسخة الخادم');
    const body = `<div><label class="form-label">كلمة المرور الحالية *</label><input required name="currentPassword" type="password" class="field" autocomplete="current-password"></div><div><label class="form-label">كلمة المرور الجديدة *</label><input required name="newPassword" type="password" minlength="12" class="field" autocomplete="new-password" placeholder="١٢ حرفًا على الأقل"></div><div><label class="form-label">تأكيد كلمة المرور الجديدة *</label><input required name="confirmPassword" type="password" minlength="12" class="field" autocomplete="new-password"></div>`;
    openModal('تغيير كلمة المرور', body, async form => {
      const next = form.get('newPassword'); if (next !== form.get('confirmPassword')) { toast('تأكيد كلمة المرور غير مطابق'); return false; }
      if (next.length < 12) { toast('كلمة المرور الجديدة لازم تكون ١٢ حرفًا على الأقل'); return false; }
      await apiRequest('/api/password', { method: 'POST', body: JSON.stringify({ currentPassword: form.get('currentPassword'), newPassword: next }) });
      toast('تم تغيير كلمة المرور بنجاح'); return true;
    }, 'تحديث كلمة المرور');
  }

  function parseCsv(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) { const c = text[i]; if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; } else if (c === '"') quoted = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c; }
    if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); } return rows.filter(r => r.some(v => v.trim()));
  }
  function importCsv() {
    if (currentUser.role !== 'المدير') return toast('استيراد قاعدة العملاء متاح للمدير فقط');
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv'; input.onchange = () => { const file = input.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const table = parseCsv(String(reader.result).replace(/^\uFEFF+/, '')); const headers = table.shift(); const pick = name => headers.findIndex(h => h.replace(/^\uFEFF+/, '').trim() === name); const ix = { id: pick('معرّف الدليل'), name: pick('اسم النشاط كما نشره الدليل'), sector: pick('القطاع'), address: pick('العنوان والمنطقة كما نشرها الدليل'), phones: pick('أرقام النشاط المنشورة'), email: pick('البريد الإلكتروني المنشور'), website: pick('الموقع الإلكتروني المنشور'), whatsapp: pick('واتساب المنشور'), source: pick('رابط المصدر'), opportunity: pick('فرصة برمجية محتملة'), note: pick('ملاحظات') }; if (ix.name < 0) throw new Error('مش لاقي عمود اسم النشاط في الملف.'); let added = 0, updated = 0, skipped = 0; for (const row of table) { const name = row[ix.name]?.trim(); if (!name) continue; const whatsapp = ix.whatsapp >= 0 ? row[ix.whatsapp]?.trim() : ''; if (!/(?:wa\.me\/|phone=)\+?\d{10,15}/i.test(whatsapp)) { skipped++; continue; } const id = ix.id >= 0 ? row[ix.id] : ''; const existing = state.leads.find(l => (id && l.id === id) || (l.name.toLocaleLowerCase() === name.toLocaleLowerCase() && l.address === (row[ix.address] || ''))); const data = { id: id || `MAD-${Date.now()}-${added}`, name, sector: ix.sector >= 0 ? row[ix.sector] : '', address: ix.address >= 0 ? row[ix.address] : '', phones: `واتساب: +${whatsappDigits(whatsapp)}`, email: ix.email >= 0 ? row[ix.email] : '', website: ix.website >= 0 ? row[ix.website] : '', whatsapp, source: ix.source >= 0 ? row[ix.source] : '', opportunity: ix.opportunity >= 0 ? row[ix.opportunity] : '', note: ix.note >= 0 ? row[ix.note] : '', status: existing?.status || 'جديد', owner: existing?.owner || (currentUser.role === 'سيلز' ? currentUser.id : ''), createdAt: existing?.createdAt || today() }; if (existing) { Object.assign(existing, data); updated++; } else { state.leads.push(data); added++; } } addActivity('import', 'استيراد قاعدة عملاء', `تمت إضافة ${added} وتحديث ${updated} سجل واستبعاد ${skipped} بلا واتساب منشور`); save(); render(); toast(`جديد ${fmt(added)} · تحديث ${fmt(updated)} · استبعاد ${fmt(skipped)} بلا واتساب`); } catch (error) { toast(error.message || 'حصلت مشكلة في قراءة الملف'); } }; reader.readAsText(file, 'utf-8'); }; input.click();
  }
  function downloadCsv() {
    const data = visibleLeads(); const headers = ['معرّف الدليل', 'اسم النشاط كما نشره الدليل', 'القطاع', 'العنوان والمنطقة كما نشرها الدليل', 'أرقام النشاط المنشورة', 'البريد الإلكتروني المنشور', 'الموقع الإلكتروني المنشور', 'واتساب المنشور', 'رابط المصدر', 'حالة التواصل', 'مسؤول المتابعة', 'ملاحظات'];
    const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`; const rows = [headers, ...data.map(l => [l.id, l.name, l.sector, l.address, l.phones, l.email, l.website, l.whatsapp, l.source, l.status, ownerName(l.owner), l.note])];
    const blob = new Blob(['\uFEFF' + rows.map(r => r.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'madar-customers.csv'; a.click(); URL.revokeObjectURL(a.href); toast('بدأ تنزيل ملف العملاء');
  }
  function onAction(action, id) {
    if (action === 'toggle-auth') { registerMode = !registerMode; loginScreen(); }
    else if (action === 'approve-member') reviewMember(id, true);
    else if (action === 'reject-member') reviewMember(id, false);
    else if (action === 'new-lead') leadModal(); else if (action === 'edit-lead') { const l = state.leads.find(x => x.id === id); if (l && (currentUser.role === 'المدير' || l.owner === currentUser.id)) { closeModal(); leadModal(l); } } else if (action === 'view-lead') viewLead(id); else if (action === 'claim-lead') claimLead(id); else if (action === 'delete-lead') deleteLead(id); else if (action === 'remove-member') removeMember(id); else if (action === 'log-contact') { closeModal(); contactModal(id); } else if (action === 'new-offer') offerModal(); else if (action === 'new-project') projectModal(); else if (action === 'new-member') memberModal(); else if (action === 'change-password') passwordModal(); else if (action === 'import') importCsv(); else if (action === 'export-csv') downloadCsv(); else if (action === 'save-target' && currentUser.role === 'المدير') { state.target = Number($('#targetInput')?.value || 0); save(); render(); toast('تم تحديث الهدف'); }
  }

  async function reviewMember(id, approve) {
    if (currentUser?.role !== 'المدير') return;
    const member = state.team.find(item => item.id === id && item.role === 'سيلز' && !item.approved);
    if (!member) return;
    try {
      await apiRequest('/api/users', { method: 'POST', body: JSON.stringify({ action: approve ? 'approve' : 'reject', id }) });
      await loadApiState(currentUser); render(); toast(approve ? `تمت الموافقة على ${member.name}` : `تم رفض طلب ${member.name}`);
    } catch (error) { toast(error.message || 'تعذر تحديث طلب التسجيل'); }
  }

  async function deleteLead(id) {
    const lead = state.leads.find(x => x.id === id); if (!lead) return;
    if (!confirm(`تحذف ${lead.name} من قاعدة العملاء؟`)) return;
    try { if (apiMode) await apiRequest(`/api/leads/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.leads = state.leads.filter(x => x.id !== id); closeModal(); save(); render(); toast('تم حذف العميل'); }
    catch (error) { toast(error.message || 'تعذر حذف العميل'); }
  }
  async function removeMember(id) {
    const member = state.team.find(x => x.id === id); if (!member || currentUser.role !== 'المدير') return;
    if (!confirm(`إيقاف حساب ${member.name}؟ ستظل بياناته محفوظة، وستصبح عملاؤه غير معيّنين.`)) return;
    try { if (apiMode) await apiRequest(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.team = state.team.filter(x => x.id !== id); state.leads.forEach(l => { if (l.owner === id) l.owner = ''; }); save(); render(); toast('تم إيقاف الحساب وإلغاء تعيين عملائه'); }
    catch (error) { toast(error.message || 'تعذر إيقاف الحساب'); }
  }

  async function claimLead(id) {
    if (currentUser?.role !== 'سيلز') return toast('استلام العملاء متاح لحسابات السيلز فقط');
    const lead = state.leads.find(item => item.id === id); if (!lead) return;
    if (lead.owner && lead.owner !== currentUser.id) return toast(`العميل اتسند بالفعل لـ ${ownerName(lead.owner)}`);
    if (lead.owner === currentUser.id) return toast('العميل بالفعل ضمن قائمتك');
    if (apiMode) {
      try { await apiRequest('/api/leads/claim', { method: 'POST', body: JSON.stringify({ id }) }); await loadApiState(currentUser); closeModal(); render(); toast(`تم استلام ${lead.name} وأصبح ضمن قائمتك`); }
      catch (error) { if (error.message.includes('استلمه فرد آخر')) { await loadApiState(currentUser); render(); } toast(error.message); }
      return;
    }
    lead.owner = currentUser.id; addActivity('assign', `استلام عميل: ${lead.name}`, `أصبح العميل ضمن متابعة ${currentUser.name}`, lead.id);
    save(); closeModal(); render(); toast(`تم استلام ${lead.name} وأصبح ضمن قائمتك`);
  }

  document.addEventListener('click', e => {
    const route = e.target.closest('[data-route]'); if (route) { setRoute(route.dataset.route); return; }
    const action = e.target.closest('[data-action]'); if (action) { onAction(action.dataset.action, action.dataset.id); return; }
    if (e.target.closest('#mobileMenu')) $('#sidebar').classList.toggle('open');
    if (e.target.closest('#dismissBanner')) { state.banner = false; save(); $('.demo-banner').classList.add('hidden'); }
    if (e.target.closest('#notifyBtn')) { const due = visibleLeads().filter(l => l.followUp && l.followUp <= today()).length; toast(due ? `عندك ${fmt(due)} متابعة مستحقة` : 'مفيش متابعات متأخرة مسجلة'); }
  });
  document.addEventListener('change', e => {
    if (e.target.matches('.status-select')) { const l = state.leads.find(x => x.id === e.target.dataset.id); if (l && l.status !== e.target.value) { l.status = e.target.value; addActivity('status', `تغيير حالة ${l.name}`, `الحالة الجديدة: ${l.status}`, l.id); save(); render(); toast('تم تحديث حالة العميل'); } }
    if (e.target.matches('.owner-select')) { const l = state.leads.find(x => x.id === e.target.dataset.id); if (l) { l.owner = e.target.value; addActivity('assign', `توزيع عميل: ${l.name}`, `المسؤول: ${ownerName(l.owner)}`, l.id); save(); render(); toast('تم توزيع العميل'); } }
    if (e.target.matches('.offer-status')) { const o = state.offers.find(x => x.id === e.target.dataset.id); if (o) { o.status = e.target.value; const l = state.leads.find(x => x.id === o.leadId); if (l && o.status === 'مقفول') l.status = 'عميل حالي'; addActivity('offer', `تحديث عرض ${l?.name || ''}`, `الحالة: ${o.status}`, o.leadId); save(); render(); toast('تم تحديث العرض'); } }
    if (e.target.matches('.project-status')) { const p = state.projects.find(x => x.id === e.target.dataset.id); if (p) { p.status = e.target.value; addActivity('project', `تحديث مشروع ${p.name}`, `الحالة: ${p.status}`, p.leadId); save(); render(); toast('تم تحديث المشروع'); } }
  });
  $('#globalSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { leadFilter = e.target.value; setRoute('leads'); setTimeout(() => { const input = $('#leadSearch'); if (input) { input.value = leadFilter; input.dispatchEvent(new Event('input')); } }, 0); } });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#globalSearch').focus(); } if (e.key === 'Escape') { closeModal(); $('#sidebar').classList.remove('open'); } if ((e.ctrlKey || e.metaKey) && /^[1-6]$/.test(e.key)) { const map = { '1': 'overview', '2': 'leads', '3': 'team', '4': 'offers', '5': 'projects', '6': 'reports' }; setRoute(map[e.key]); } });
  async function boot() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        const bootInfo = await apiRequest('/api/bootstrap'); apiMode = true; setupRequired = bootInfo.setupRequired;
        if (!setupRequired) {
          try { const session = await apiRequest('/api/session'); await loadApiState(session.user); enterApp(); return; } catch {}
        }
      } catch {
        apiMode = true;
        login.innerHTML = `<div class="login-panel"><div class="login-box"><div class="brand-lockup"><div class="brand-mark"><span>م</span><i></i></div><div><b>مَدار</b><small>تعذر الاتصال</small></div></div><h1>النظام مش قادر يوصل لقاعدة البيانات.</h1><p>راجع إعداد DATABASE_URL وSESSION_SECRET في إعدادات Vercel، وبعدها حدّث الصفحة.</p></div></div>`;
        return;
      }
    }
    loginScreen();
    if (!apiMode) { const remembered = sessionStorage.getItem('madar_user'); const member = state.team.find(x => x.id === remembered); if (member) { currentUser = member; enterApp(); } }
  }
  boot();
})();

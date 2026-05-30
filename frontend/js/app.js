const socket = io();
let selectedConversationId = null;
let currentConversations = [];
let currentContacts = [];
let currentMedia = [];
let automationStepsData = [];
let selectedCampaignIds = new Set();
let draggedAutomationStepIndex = null;

const latinDateTimeFormatter = new Intl.DateTimeFormat('en-GB-u-nu-latn', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const latinTimeFormatter = new Intl.DateTimeFormat('en-GB-u-nu-latn', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function formatLatinDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : latinDateTimeFormatter.format(date);
}

function formatLatinTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : latinTimeFormatter.format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function createAutomationStep(type) {
  if (type === 'text') return { type, text: '' };
  if (type === 'delay') return { type, seconds: 60 };
  if (type === 'image') return { type, media_id: '', caption: '' };
  return { type, media_id: '' };
}

function getDelayMultiplier(unit) {
  if (unit === 'minutes') return 60;
  if (unit === 'hours') return 3600;
  if (unit === 'days') return 86400;
  return 1;
}

function normalizeDelaySeconds(value) {
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 1;
}

function getStepDelaySeconds(step) {
  if (!step) return 60;
  if (step.seconds !== undefined && step.seconds !== null && step.seconds !== '') {
    return normalizeDelaySeconds(step.seconds);
  }
  if (step.minutes !== undefined && step.minutes !== null && step.minutes !== '') {
    return normalizeDelaySeconds(Number(step.minutes) * 60);
  }
  return 60;
}

function getDelayParts(secondsValue) {
  const seconds = normalizeDelaySeconds(secondsValue || 60);
  if (seconds % 86400 === 0) return { value: seconds / 86400, unit: 'days' };
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: 'hours' };
  if (seconds % 60 === 0) return { value: seconds / 60, unit: 'minutes' };
  return { value: seconds, unit: 'seconds' };
}

function formatDelayLabel(secondsValue) {
  const seconds = normalizeDelaySeconds(secondsValue || 60);
  const parts = getDelayParts(seconds);
  const unitLabel = parts.unit === 'days' ? 'يوم' : parts.unit === 'hours' ? 'ساعة' : parts.unit === 'minutes' ? 'دقيقة' : 'ثانية';
  return `${parts.value} ${unitLabel}`;
}

function updateAutomationDelayFromControls(index, row) {
  const valueInput = row.querySelector('.delay-value-input');
  const unitSelect = row.querySelector('.delay-unit-select');
  if (!valueInput || !unitSelect) return;
  const value = Math.max(1, Number(valueInput.value) || 1);
  const seconds = normalizeDelaySeconds(value * getDelayMultiplier(unitSelect.value));
  automationStepsData[index].seconds = seconds;
  delete automationStepsData[index].minutes;
  const previewText = row.querySelector('.delay-preview-text');
  if (previewText) {
    previewText.textContent = `مدة المؤقت الحالية: ${formatDelayLabel(seconds)}`;
  }
  renderAutomationPreview(automationStepsData);
}

function getAutomationTriggerMode() {
  return document.querySelector('input[name="automationTriggerMode"]:checked')?.value || 'first_message';
}

function setAutomationTriggerMode(mode) {
  const safeMode = ['first_message', 'every_message', 'cooldown'].includes(mode) ? mode : 'first_message';
  document.querySelectorAll('input[name="automationTriggerMode"]').forEach((input) => {
    input.checked = input.value === safeMode;
  });
  updateCooldownSettingVisibility();
}

function updateCooldownSettingVisibility() {
  const cooldownSetting = document.getElementById('cooldownSetting');
  if (!cooldownSetting) return;
  cooldownSetting.classList.toggle('d-none', getAutomationTriggerMode() !== 'cooldown');
}

function automationActionIcon(name) {
  const icons = {
    up: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m18 15-6-6-6 6" /></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>',
    delete: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>'
  };
  return icons[name] || '';
}

window.addEventListener('load', () => {
  document.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => switchSection(button.dataset.section));
  });

  document.getElementById('replyForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('replyInput');
    const text = input.value.trim();
    if (!selectedConversationId || !text) return;
    await sendReply(text);
    input.value = '';
    loadMessages(selectedConversationId);
  });

  document.getElementById('searchInput').addEventListener('input', (event) => {
    const query = event.target.value.trim();
    if (!query) return loadContacts();
    searchContacts(query);
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });

  const uploadForm = document.getElementById('uploadForm');
  if (uploadForm) {
    uploadForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const fileInput = form.querySelector('input[name="media"]');
      if (!fileInput.files.length) return;
      const data = new FormData();
      data.append('media', fileInput.files[0]);
      const res = await fetch('/api/media/upload', { method: 'POST', body: data });
      const body = await res.json();
      if (body.success) {
        fileInput.value = '';
        loadMedia();
      }
    });
  }

  document.getElementById('addTextStepBtn')?.addEventListener('click', () => addAutomationStep('text'));
  document.getElementById('addImageStepBtn')?.addEventListener('click', () => addAutomationStep('image'));
  document.getElementById('addAudioStepBtn')?.addEventListener('click', () => addAutomationStep('audio'));
  document.getElementById('addDelayStepBtn')?.addEventListener('click', () => addAutomationStep('delay'));
  document.getElementById('sendCampaignBtn')?.addEventListener('click', sendCampaign);
  document.getElementById('clearSelectionBtn')?.addEventListener('click', clearCampaignSelection);
  document.querySelectorAll('input[name="automationTriggerMode"]').forEach((input) => {
    input.addEventListener('change', updateCooldownSettingVisibility);
  });

  document.getElementById('saveAutomationBtn').addEventListener('click', saveAutomationSettings);
  document.getElementById('refreshQr')?.addEventListener('click', loadQrSection);

  socket.on('new_message', () => refreshData());
  socket.on('automation_triggered', () => refreshData());
  socket.on('session_update', (status) => renderStatus(status));

  refreshData();
  switchSection('inbox');
});

function renderStatus(status) {
  const badge = document.getElementById('sessionStatus');
  if (!status) return;
  badge.textContent = status.state === 'connected' ? 'متاصل' : status.state === 'qr' ? 'انتظر QR' : 'مقطوع';
  badge.className = `badge ${status.state === 'connected' ? 'bg-success' : status.state === 'qr' ? 'bg-warning' : 'bg-danger'}`;
}

function showToast(message, type = 'success', duration = 3200) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toastEl = document.createElement('div');
  toastEl.className = `toast align-items-center text-white border-0 mb-2 ${type === 'error' ? 'bg-danger' : type === 'warning' ? 'bg-warning text-dark' : 'bg-success'}`;
  toastEl.role = 'alert';
  toastEl.ariaLive = 'polite';
  toastEl.ariaAtomic = 'true';
  toastEl.innerHTML = `
    <div class="d-flex align-items-center p-2">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white ms-auto me-2" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
  `;
  container.appendChild(toastEl);
  const bsToast = new bootstrap.Toast(toastEl, { delay: duration });
  bsToast.show();
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

async function refreshData() {
  await Promise.all([loadInbox(), loadContacts(), loadMedia(), loadAutomation(), loadLogs(), loadMetrics()]);
  document.getElementById('lastSync').textContent = formatLatinTime();
}

async function switchSection(section) {
  document.querySelectorAll('#sectionMenu button').forEach((button) => {
    button.classList.toggle('active', button.dataset.section === section);
  });
  document.querySelectorAll('#inboxSection, #contactsSection, #automationSection, #mediaSection, #logsSection, #qrSection').forEach((sectionEl) => {
    sectionEl.classList.add('d-none');
  });
  document.getElementById(`${section}Section`).classList.remove('d-none');
  if (section === 'qr') loadQrSection();
}

async function loadInbox() {
  const res = await fetch('/api/conversations');
  const body = await res.json();
  if (!body.success) return;
  currentConversations = body.conversations || [];
  document.getElementById('countConversations').textContent = currentConversations.length;
  renderConversationList();
}

function renderConversationList() {
  const list = document.getElementById('conversationList');
  list.innerHTML = '';
  currentConversations.forEach((conv) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `list-group-item list-group-item-action ${selectedConversationId === conv.id ? 'active' : ''}`;
    item.innerHTML = `<div class="d-flex justify-content-between"><div><strong>${conv.contact_name}</strong><div class="small text-muted">${conv.last_message || 'لا توجد رسالة بعد'}</div></div><span class="badge bg-info">${conv.unread_count || 0}</span></div>`;
    item.addEventListener('click', () => {
      selectedConversationId = conv.id;
      renderConversationList();
      loadMessages(conv.id);
    });
    list.appendChild(item);
  });
}

async function loadMessages(conversationId) {
  const res = await fetch(`/api/conversations/${conversationId}/messages`);
  const body = await res.json();
  if (!body.success) return;
  const container = document.getElementById('chatWindow');
  container.innerHTML = '';
  body.messages.forEach((msg) => {
    const row = document.createElement('div');
    row.className = `message-row ${msg.direction === 'out' ? 'message-out' : 'message-in'}`;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (msg.type === 'image') {
      bubble.innerHTML = `<div><img src="/${msg.media_path}" class="img-fluid rounded" alt="صورة" /></div>`;
    } else if (msg.type === 'audio') {
      bubble.innerHTML = `<audio controls src="/${msg.media_path}" class="w-100"></audio>`;
    } else {
      bubble.textContent = msg.body;
    }
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = formatLatinDateTime(msg.timestamp);
    row.appendChild(bubble);
    row.appendChild(time);
    container.appendChild(row);
  });
  container.scrollTop = container.scrollHeight;
}

async function sendReply(text) {
  const res = await fetch(`/api/conversations/${selectedConversationId}/reply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
  });
  const body = await res.json();
  if (!body.success) showToast(body.message || 'فشل الإرسال', 'error');
  else loadInbox();
}

async function loadContacts() {
  const res = await fetch('/api/contacts');
  const body = await res.json();
  if (!body.success) return;
  currentContacts = body.contacts;
  const contactsCounter = document.getElementById('countContacts');
  if (contactsCounter) contactsCounter.textContent = currentContacts.length;
  renderContacts();
  updateSelectionBadge();
}

function renderContacts() {
  const list = document.getElementById('contactsList');
  list.innerHTML = '';
  currentContacts.forEach((contact) => {
    const selected = selectedCampaignIds.has(String(contact.id));
    const item = document.createElement('div');
    item.className = 'list-group-item bg-secondary border-0';
    item.innerHTML = `
      <div class="d-flex justify-content-between align-items-center gap-3">
        <div class="form-check d-flex align-items-center gap-2 m-0">
          <input class="form-check-input campaign-checkbox" type="checkbox" id="contact-${contact.id}" data-contact-id="${contact.id}" ${selected ? 'checked' : ''}>
          <label class="form-check-label mb-0" for="contact-${contact.id}">
            <strong>${contact.name || contact.phone}</strong>
            <div class="small text-muted">${contact.tags || contact.phone}</div>
          </label>
        </div>
      </div>
    `;

    const checkbox = item.querySelector('.campaign-checkbox');
    checkbox.addEventListener('change', () => {
      toggleContactSelection(contact.id, checkbox.checked);
    });

    list.appendChild(item);
  });
}

function toggleContactSelection(contactId, selected) {
  if (selected) {
    selectedCampaignIds.add(String(contactId));
  } else {
    selectedCampaignIds.delete(String(contactId));
  }
  updateSelectionBadge();
}

function clearCampaignSelection() {
  selectedCampaignIds.clear();
  updateSelectionBadge();
  renderContacts();
}

function updateSelectionBadge() {
  const badge = document.getElementById('selectedContactsCount');
  if (badge) {
    badge.textContent = `${selectedCampaignIds.size} مختار`;
  }
}

async function searchContacts(query) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const body = await res.json();
  if (!body.success) return;
  currentContacts = body.contacts;
  renderContacts();
}

async function sendCampaign() {
  const text = document.getElementById('campaignMessage')?.value.trim();
  if (!selectedCampaignIds.size) {
    showToast('اختر جهة اتصال واحدة على الأقل لإرسال الحملة.', 'warning');
    return;
  }
  if (!text) {
    showToast('اكتب رسالة الحملة أولاً.', 'warning');
    return;
  }

  const button = document.getElementById('sendCampaignBtn');
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'جاري الإرسال...';
  }

  try {
    const res = await fetch('/api/campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: Array.from(selectedCampaignIds), text })
    });
    const body = await res.json();
    if (!body.success) {
      showToast(body.message || 'فشل إرسال الحملة.', 'error');
      return;
    }
    showToast('تم إرسال الحملة بنجاح.');
    document.getElementById('campaignMessage').value = '';
    clearCampaignSelection();
    await refreshData();
  } catch (error) {
    showToast('حدث خطأ أثناء إرسال الحملة.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function loadMetrics() {
  const res = await fetch('/api/metrics');
  const body = await res.json();
  if (!body.success) return;
  const metrics = body.metrics || {};
  document.getElementById('activeChats').textContent = metrics.active || 0;
  document.getElementById('responseRate').textContent = `${metrics.responseRate || 0}%`;
  document.getElementById('automationHits').textContent = metrics.automationHits || 0;
}

async function loadAutomation() {
  const res = await fetch('/api/automation');
  const body = await res.json();
  if (!body.success) return;
  const automation = body.automation || {};
  automationStepsData = (automation.steps || [])
    .filter((step) => step && step.type)
    .map((step) => (
      step.type === 'delay' ? { ...step, seconds: getStepDelaySeconds(step), minutes: undefined } : step
    ));
  const enabledCheckbox = document.getElementById('automationEnabled');
  if (enabledCheckbox) enabledCheckbox.checked = automation.enabled === 1;
  setAutomationTriggerMode(automation.trigger_mode || 'first_message');
  document.getElementById('cooldownHours').value = automation.cooldown_hours || 24;
  renderAutomationSteps(automationStepsData);
  renderAutomationPreview(automationStepsData);
}

function renderAutomationSteps(steps) {
  const container = document.getElementById('automationSteps');
  container.innerHTML = '';
  if (steps.length === 0) {
    const emptyReminder = document.createElement('div');
    emptyReminder.className = 'alert alert-light';
    emptyReminder.textContent = 'اضغط على أحد الأزرار لإضافة خطوة نص أو صورة أو صوت أو مؤقت.';
    container.appendChild(emptyReminder);
    renderAutomationPreview(steps);
    return;
  }

  steps.forEach((step, index) => {
    const row = document.createElement('div');
    row.className = 'card automation-step-card border-0 p-3 mb-3';
    row.dataset.stepIndex = index;
    const labelText = step.type === 'text'
      ? 'نص الرد'
      : step.type === 'image'
        ? 'صورة أتمتة'
        : step.type === 'audio'
          ? 'صوت أتمتة'
          : 'مؤقت انتظار';
    const placeholder = step.type === 'text' ? 'اكتب نص الرد هنا' : 'اختر ملفًا لتحميله تلقائيًا';
    const mediaUploaded = step.media_id || step.media_path;
    const delaySeconds = getStepDelaySeconds(step);
    const delayParts = getDelayParts(delaySeconds);
    const imageCaptionHtml = step.type === 'image' ? `
      <div class="mt-3">
        <label class="form-label">كابشن الصورة</label>
        <textarea rows="2" class="form-control image-caption-input" data-step-index="${index}" placeholder="اكتب النص الذي سيظهر مع الصورة في نفس الرسالة">${escapeHtml(step.caption || '')}</textarea>
      </div>
    ` : '';
    const delayInputHtml = step.type === 'delay' ? `
      <div class="mb-3">
        <label class="form-label">مدة المؤقت</label>
        <div class="delay-config-grid">
          <input type="number" min="1" class="form-control form-control-sm delay-value-input" data-step-index="${index}" value="${delayParts.value}" />
          <select class="form-control form-control-sm delay-unit-select" data-step-index="${index}">
            <option value="seconds" ${delayParts.unit === 'seconds' ? 'selected' : ''}>ثواني</option>
            <option value="minutes" ${delayParts.unit === 'minutes' ? 'selected' : ''}>دقائق</option>
            <option value="hours" ${delayParts.unit === 'hours' ? 'selected' : ''}>ساعات</option>
            <option value="days" ${delayParts.unit === 'days' ? 'selected' : ''}>أيام</option>
          </select>
        </div>
      </div>
      <div class="small text-muted delay-preview-text">مدة المؤقت الحالية: ${formatDelayLabel(delaySeconds)}</div>
      <div class="small text-muted">سيتم إرسال الخطوات التالية بعد مرور هذه المدة.</div>
    ` : '';
    const fileUploadHtml = step.type !== 'text' && step.type !== 'delay' ? `
      <div class="form-text text-muted mb-2">اختر ملف ${step.type} لرفعه تلقائيًا وحفظه مع الأتمتة.</div>
      ${mediaUploaded ? `<div class="mb-3">${step.type === 'image' ? `<img src="/${step.media_path || ''}" class="img-fluid rounded" style="max-height:140px;" alt="معاينة" />` : step.media_path ? `<audio controls src="/${step.media_path}" class="w-100"></audio>` : ''}</div>` : `<input type="file" class="form-control form-control-sm automation-step-upload mb-2" data-upload-index="${index}" accept="${step.type === 'image' ? 'image/*' : 'audio/*'}" />`}
      ${mediaUploaded ? `<input type="text" readonly class="form-control form-control-sm mb-2" value="تم رفع الملف: ${step.filename || 'تم رفع ملف'}" />` : ''}
      <div class="small step-upload-hint ${mediaUploaded ? 'text-success' : 'text-muted'}">${mediaUploaded ? `تم رفع الملف: ${step.filename || 'تم رفع ملف'} · اضغط حفظ لحفظ الأتمتة` : 'لم يتم اختيار ملف بعد'}</div>
      ${mediaUploaded ? `<button type="button" class="btn btn-sm btn-outline-light mt-2 reset-file-btn" data-step-index="${index}">رفع ملف جديد</button>` : ''}
      ${imageCaptionHtml}
    ` : '';

    row.innerHTML = `
      <div class="d-flex flex-column flex-xl-row justify-content-between align-items-start gap-3 mb-3">
        <div class="automation-step-title">
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="automation-drag-handle" title="اسحب لترتيب الخطوات" aria-label="اسحب لترتيب الخطوات">≡</span>
            <h6 class="mb-0">${labelText}</h6>
            <span class="badge bg-secondary text-dark text-uppercase">${step.type}</span>
          </div>
          <div class="small text-muted">${step.type === 'text' ? 'اكتب نصًا جاهزًا للإرسال' : step.type === 'delay' ? 'حدد مدة الانتظار ثم أضف الخطوة التالية.' : mediaUploaded ? 'تم رفع الملف. اضغط حفظ لحفظ الأتمتة أو ارفع ملفًا جديدًا.' : 'اختر ملفًا من جهازك لرفعه تلقائيًا'}</div>
        </div>
        <div class="automation-step-actions d-flex flex-wrap gap-1 justify-content-end">
          <button type="button" class="btn btn-sm btn-outline-light automation-icon-btn move-step-btn" title="أعلى" aria-label="أعلى" data-direction="-1" data-step-index="${index}" ${index === 0 ? 'disabled' : ''}>${automationActionIcon('up')}</button>
          <button type="button" class="btn btn-sm btn-outline-light automation-icon-btn move-step-btn" title="أسفل" aria-label="أسفل" data-direction="1" data-step-index="${index}" ${index === steps.length - 1 ? 'disabled' : ''}>${automationActionIcon('down')}</button>
          <button type="button" class="btn btn-sm btn-outline-light automation-icon-btn remove-step-btn" title="حذف" aria-label="حذف" data-step-index="${index}">${automationActionIcon('delete')}</button>
        </div>
      </div>
      ${step.type === 'text' ? `<textarea rows="3" class="form-control mb-2" data-step-index="${index}" data-step-type="${step.type}" placeholder="${placeholder}">${escapeHtml(step.text || '')}</textarea>` : ''}
      ${step.type === 'delay' ? delayInputHtml : ''}
      ${fileUploadHtml}
    `;

    const dragHandle = row.querySelector('.automation-drag-handle');
    if (dragHandle) {
      dragHandle.draggable = true;
      dragHandle.addEventListener('dragstart', (event) => {
        draggedAutomationStepIndex = index;
        row.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      });
      dragHandle.addEventListener('dragend', () => {
        draggedAutomationStepIndex = null;
        document.querySelectorAll('.automation-step-card').forEach((card) => {
          card.classList.remove('is-dragging', 'is-drag-over');
        });
      });
    }

    row.addEventListener('dragover', (event) => {
      if (draggedAutomationStepIndex === null || draggedAutomationStepIndex === index) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('is-drag-over');
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('is-drag-over');
    });

    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('is-drag-over');
      const fromIndex = draggedAutomationStepIndex ?? Number(event.dataTransfer.getData('text/plain'));
      reorderAutomationStep(fromIndex, index);
    });

    const textInput = row.querySelector('textarea[data-step-type="text"]');
    if (textInput) {
      textInput.addEventListener('input', (event) => {
        automationStepsData[index].text = event.target.value;
        renderAutomationPreview(automationStepsData);
      });
    }

    const captionInput = row.querySelector('.image-caption-input');
    if (captionInput) {
      captionInput.addEventListener('input', (event) => {
        automationStepsData[index].caption = event.target.value;
        renderAutomationPreview(automationStepsData);
      });
    }

    row.querySelectorAll('.delay-value-input, .delay-unit-select').forEach((control) => {
      const eventName = control.classList.contains('delay-unit-select') ? 'change' : 'input';
      control.addEventListener(eventName, () => updateAutomationDelayFromControls(index, row));
    });

    const fileInput = row.querySelector('.automation-step-upload');
    if (fileInput) {
      fileInput.addEventListener('change', () => uploadAutomationMedia(index, fileInput));
    }

    const resetButton = row.querySelector('.reset-file-btn');
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        automationStepsData[index].media_id = null;
        automationStepsData[index].media_path = null;
        automationStepsData[index].filename = null;
        renderAutomationSteps(automationStepsData);
      });
    }

    row.querySelectorAll('.move-step-btn').forEach((button) => {
      button.addEventListener('click', () => moveAutomationStep(index, Number(button.dataset.direction)));
    });
    row.querySelector('.remove-step-btn').addEventListener('click', () => removeAutomationStep(index));
    container.appendChild(row);
  });
  renderAutomationPreview(steps);
}

async function uploadAutomationMedia(index, fileInput) {
  if (!fileInput || !fileInput.files.length) {
    showToast('اختر ملفًا للرفع.', 'warning');
    return;
  }
  const file = fileInput.files[0];
  const hint = fileInput.closest('.automation-step-card').querySelector('.step-upload-hint');
  if (hint) {
    hint.textContent = 'جاري رفع الملف...';
    hint.className = 'small text-info';
  }
  fileInput.disabled = true;

  const formData = new FormData();
  formData.append('media', file);

  try {
    const res = await fetch('/api/media/upload', { method: 'POST', body: formData });
    const body = await res.json();
    if (!body.success) {
      showToast(body.message || 'فشل رفع الوسائط.', 'error');
      if (hint) {
        hint.textContent = 'فشل رفع الملف. حاول مرة أخرى.';
        hint.className = 'small text-danger';
      }
      return;
    }

    automationStepsData[index].media_id = body.id || automationStepsData[index].media_id;
    automationStepsData[index].media_path = body.path || automationStepsData[index].media_path;
    automationStepsData[index].filename = body.filename || file.name;
    if (hint) {
      hint.textContent = `تم رفع الملف: ${automationStepsData[index].filename} · اضغط حفظ لحفظ الأتمتة`;
      hint.className = 'small text-success';
    }
    showToast('تم رفع الوسائط تلقائيًا.', 'success');
    await loadMedia();
    renderAutomationSteps(automationStepsData);
  } catch (error) {
    showToast('فشل رفع الملف. حاول مرة أخرى.', 'error');
    if (hint) {
      hint.textContent = 'فشل رفع الملف. حاول مرة أخرى.';
      hint.className = 'small text-danger';
    }
  } finally {
    fileInput.disabled = false;
  }
}

function addAutomationStep(type) {
  automationStepsData.push(createAutomationStep(type));
  renderAutomationSteps(automationStepsData);
}

function moveAutomationStep(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= automationStepsData.length) return;
  const currentStep = automationStepsData[index];
  automationStepsData[index] = automationStepsData[targetIndex];
  automationStepsData[targetIndex] = currentStep;
  renderAutomationSteps(automationStepsData);
}

function reorderAutomationStep(fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
  if (fromIndex < 0 || fromIndex >= automationStepsData.length || toIndex < 0 || toIndex >= automationStepsData.length) return;
  const [movedStep] = automationStepsData.splice(fromIndex, 1);
  automationStepsData.splice(toIndex, 0, movedStep);
  renderAutomationSteps(automationStepsData);
}

function removeAutomationStep(index) {
  automationStepsData.splice(index, 1);
  renderAutomationSteps(automationStepsData);
}

async function saveAutomationSettings() {
  const enabled = document.getElementById('automationEnabled')?.checked ?? true;
  const trigger_mode = getAutomationTriggerMode();
  const cooldown_hours = Number(document.getElementById('cooldownHours').value) || 24;
  const steps = automationStepsData.map((step) => {
    if (step.type === 'text') {
      return { type: step.type, text: step.text || '' };
    }
    if (step.type === 'delay') {
      return { type: step.type, seconds: getStepDelaySeconds(step) };
    }
    if (step.type === 'image') {
      return { type: step.type, media_id: step.media_id || '', caption: step.caption || '' };
    }
    return { type: step.type, media_id: step.media_id || '' };
  });

  const saveButton = document.getElementById('saveAutomationBtn');
  const originalText = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>جارٍ الحفظ`;
  try {
    const res = await fetch('/api/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, trigger_mode, cooldown_hours, steps })
    });
    const result = await res.json();
    if (result.success) {
      showToast('تم حفظ الأتمتة بنجاح');
      await loadAutomation();
    } else {
      showToast(result.message || 'حدث خطأ أثناء الحفظ', 'error');
    }
  } catch (error) {
    showToast('حدث خطأ أثناء الحفظ', 'error');
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalText;
  }
}

function renderAutomationPreview(steps) {
  const preview = document.getElementById('previewPanel');
  preview.innerHTML = '';
  if (!steps.length) {
    preview.innerHTML = '<div class="text-muted">لا توجد خطوات بعد. أضف نصًا أو صورة أو صوتًا لإظهار المعاينة.</div>';
    return;
  }

  steps.forEach((step, index) => {
    const item = document.createElement('div');
    item.className = 'preview-step p-3 mb-2 rounded';
    item.style.background = 'rgba(37, 211, 102, 0.08)';
    let mediaLabel = 'لم يتم إدخال نص بعد';
    if (step.type === 'text') {
      mediaLabel = step.text || 'لم يتم إدخال نص بعد';
    } else if (step.type === 'delay') {
      mediaLabel = `انتظار ${formatDelayLabel(getStepDelaySeconds(step))} ثم متابعة الرسائل.`;
    } else if (step.type === 'image') {
      const captionLabel = step.caption ? ` · كابشن: ${step.caption}` : '';
      mediaLabel = step.media_id ? `${step.filename || 'تم رفع صورة'}${captionLabel}` : 'لم يتم اختيار صورة بعد';
    } else {
      mediaLabel = step.media_id ? `${step.filename || 'تم رفع وسائط'}` : 'لم يتم اختيار ملف بعد';
    }
    item.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-1">
        <strong>الخطوة ${index + 1}</strong>
        <span class="badge bg-secondary text-dark">${step.type}</span>
      </div>
      <div class="small text-muted">${escapeHtml(mediaLabel)}</div>
    `;
    preview.appendChild(item);
  });
}

async function loadMedia() {
  const gallery = document.getElementById('mediaGallery');
  if (!gallery) return;
  const res = await fetch('/api/media');
  const body = await res.json();
  if (!body.success) return;
  currentMedia = body.media;
  gallery.innerHTML = '';
  currentMedia.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'col-12 col-md-6';
    card.innerHTML = `
      <div class="card bg-secondary border-0 p-3 h-100">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <span class="badge bg-info">ID ${item.id}</span>
          <button class="btn btn-sm btn-danger" data-delete-id="${item.id}">حذف</button>
        </div>
        ${item.type === 'image' ? `<img src="/${item.path}" class="img-fluid rounded mb-2" alt="صورة" />` : `<audio controls src="/${item.path}" class="w-100 mb-2"></audio>`}
        <div class="small text-muted">${item.original_name}</div>
      </div>
    `;
    gallery.appendChild(card);
  });
  gallery.querySelectorAll('[data-delete-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.deleteId;
      await fetch(`/api/media/${id}`, { method: 'DELETE' });
      loadMedia();
    });
  });
}

async function loadLogs() {
  const res = await fetch('/api/logs');
  const body = await res.json();
  if (!body.success) return;
  const list = document.getElementById('logItems');
  list.innerHTML = '';
  body.logs.forEach((log) => {
    const item = document.createElement('div');
    item.className = 'list-group-item bg-secondary border-0';
    item.innerHTML = `<div><strong>${log.event}</strong></div><div class="small text-muted">${formatLatinDateTime(log.created_at)} - ${log.details}</div>`;
    list.appendChild(item);
  });
}

async function loadQrSection() {
  const area = document.getElementById('qrArea');
  const res = await fetch('/api/qr');
  const body = await res.json();
  area.innerHTML = body.qr ? `<img src="${body.qr}" class="img-fluid" alt="QR" />` : '<p class="text-muted">انتظر ظهور QR...</p>';
}

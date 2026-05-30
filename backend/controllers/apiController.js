const db = require('../database/db');
const whatsappService = require('../services/whatsappService');
const automationService = require('../services/automationService');
const logService = require('../services/logService');

async function getStatus(req, res) {
  const status = whatsappService.getSessionStatus();
  res.json({ success: true, session: status });
}

async function getQr(req, res) {
  const status = whatsappService.getSessionStatus();
  res.json({ success: true, qr: status.qr, state: status.state });
}

async function getConversations(req, res) {
  const conversations = await db.query(`
    SELECT c.*, COALESCE(ct.name, SUBSTRING_INDEX(c.chat_id, '@', 1)) AS contact_name
    FROM conversations c
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    ORDER BY c.last_at DESC, c.created_at DESC
  `);
  res.json({ success: true, conversations });
}

async function getMessages(req, res) {
  const conversationId = req.params.id;
  const messages = await db.query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC', [conversationId]);
  res.json({ success: true, messages });
}

async function sendReply(req, res) {
  const conversationId = req.params.id;
  const { text, media_id } = req.body;
  const conv = await db.query('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (!conv.length) return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
  const conversation = conv[0];
  if (!text && !media_id) return res.status(400).json({ success: false, message: 'أدخل نص أو وسائط للإرسال' });

  try {
    if (media_id) {
      const mediaRows = await db.query('SELECT * FROM media WHERE id = ?', [media_id]);
      if (!mediaRows.length) return res.status(404).json({ success: false, message: 'الوسائط غير موجودة' });
      const media = mediaRows[0];
      await whatsappService.sendMediaById(conversation.chat_id, media.id, media.type);
      await db.query('INSERT INTO messages (conversation_id, sender, body, type, media_path, direction, timestamp) VALUES (?, ?, ?, ?, ?, ?, NOW())', [
        conversationId,
        'admin',
        `تم إرسال ${media.type}`,
        media.type,
        media.path,
        'out'
      ]);
    }
    if (text) {
      await whatsappService.sendText(conversation.chat_id, text);
      await db.query('INSERT INTO messages (conversation_id, sender, body, type, direction, timestamp) VALUES (?, ?, ?, ?, ?, NOW())', [
        conversationId,
        'admin',
        text,
        'text',
        'out'
      ]);
    }

    await db.query('UPDATE conversations SET status = ?, unread_count = 0, last_message = ?, last_at = NOW() WHERE id = ?', [
      'Seen',
      text || `تم إرسال ${media_id ? 'وسائط' : ''}`,
      conversationId
    ]);
    await logService.create('info', 'manual_reply', `reply sent to ${conversation.chat_id}`);
    whatsappService.emitUpdate();
    return res.json({ success: true, message: 'تم إرسال الرد' });
  } catch (error) {
    await logService.create('error', 'send_reply_error', error.message);
    return res.status(500).json({ success: false, message: 'حدث خطأ أثناء الإرسال' });
  }
}

async function closeConversation(req, res) {
  const conversationId = req.params.id;
  await db.query('UPDATE conversations SET status = ? WHERE id = ?', ['Closed', conversationId]);
  whatsappService.emitUpdate();
  res.json({ success: true, message: 'تم إغلاق المحادثة' });
}

async function getContacts(req, res) {
  const contacts = await db.query('SELECT * FROM contacts ORDER BY last_interaction IS NULL, last_interaction DESC');
  res.json({ success: true, contacts });
}

async function updateContact(req, res) {
  const id = req.params.id;
  const { name, tags, notes } = req.body;
  await db.query('UPDATE contacts SET name = ?, tags = ?, notes = ? WHERE id = ?', [name, tags, notes, id]);
  res.json({ success: true, message: 'تم تحديث الكونطاكت' });
}

async function getAutomation(req, res) {
  const automation = await automationService.getAutomation();
  res.json({ success: true, automation });
}

async function saveAutomation(req, res) {
  const { enabled, cooldown_hours, steps, trigger_mode } = req.body;
  await automationService.saveAutomation({ enabled, cooldown_hours, steps, trigger_mode });
  res.json({ success: true, message: 'تم حفظ إعدادات الأتمتة' });
}

async function getMetrics(req, res) {
  const totalRes = await db.query('SELECT COUNT(*) AS total FROM conversations');
  const activeRes = await db.query("SELECT COUNT(*) AS active FROM conversations WHERE status != 'Closed'");
  const respondedRes = await db.query("SELECT COUNT(DISTINCT conversation_id) AS responded FROM messages WHERE direction = 'out'");
  const automationHitsRes = await db.query("SELECT COUNT(*) AS count FROM logs WHERE event = 'automation_step'");

  const total = totalRes[0]?.total || 0;
  const active = activeRes[0]?.active || 0;
  const responded = respondedRes[0]?.responded || 0;
  const automationHits = automationHitsRes[0]?.count || 0;
  const responseRate = total ? Math.round((responded / total) * 100) : 0;

  res.json({ success: true, metrics: { total, active, responseRate, automationHits } });
}

async function sendCampaign(req, res) {
  const { contact_ids, text } = req.body;
  if (!Array.isArray(contact_ids) || !contact_ids.length) {
    return res.status(400).json({ success: false, message: 'اختر جهات اتصال للحملة' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, message: 'اكتب رسالة للحملة' });
  }

  const contacts = await db.query(`SELECT * FROM contacts WHERE id IN (${contact_ids.map(() => '?').join(',')})`, contact_ids);
  if (!contacts.length) {
    return res.status(404).json({ success: false, message: 'لم يتم العثور على جهات اتصال' });
  }

  try {
    for (const contact of contacts) {
      const chatId = contact.phone.includes('@') ? contact.phone : `${contact.phone}@c.us`;
      await whatsappService.sendText(chatId, text);
      const existingConv = await db.query('SELECT * FROM conversations WHERE chat_id = ?', [chatId]);
      let conversationId;
      if (existingConv.length) {
        conversationId = existingConv[0].id;
        await db.query('UPDATE conversations SET last_message = ?, last_at = NOW(), status = ?, unread_count = 0 WHERE id = ?', ['حملة مرسلة', 'Seen', conversationId]);
      } else {
        const result = await db.query('INSERT INTO conversations (chat_id, contact_id, status, unread_count, last_message, last_at) VALUES (?, ?, ?, ?, ?, NOW())', [chatId, contact.id, 'Seen', 0, 'حملة مرسلة']);
        conversationId = result.insertId;
      }
      await db.query('INSERT INTO messages (conversation_id, sender, body, type, direction, timestamp) VALUES (?, ?, ?, ?, ?, NOW())', [conversationId, 'admin', text, 'text', 'out']);
    }

    await logService.create('info', 'campaign_sent', `sent campaign to ${contacts.length} contacts`);
    return res.json({ success: true, message: 'تم إرسال الحملة بنجاح' });
  } catch (error) {
    await logService.create('error', 'campaign_error', error.message);
    return res.status(500).json({ success: false, message: 'حدث خطأ أثناء إرسال الحملة' });
  }
}

async function getMedia(req, res) {
  const media = await db.query('SELECT * FROM media ORDER BY uploaded_at DESC');
  res.json({ success: true, media });
}

async function getLogs(req, res) {
  const logs = await logService.list(150);
  res.json({ success: true, logs });
}

async function searchContacts(req, res) {
  const q = `%${(req.query.q || '').trim().toLowerCase()}%`;
  const contacts = await db.query('SELECT * FROM contacts WHERE LOWER(name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(tags) LIKE ? ORDER BY last_interaction DESC', [q, q, q]);
  res.json({ success: true, contacts });
}

module.exports = {
  getStatus,
  getQr,
  getConversations,
  getMessages,
  sendReply,
  closeConversation,
  getContacts,
  updateContact,
  getAutomation,
  saveAutomation,
  getMetrics,
  sendCampaign,
  getMedia,
  getLogs,
  searchContacts
};

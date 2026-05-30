# WhatsApp Automation CRM

Mini WhatsApp CRM built with `whatsapp-web.js`, `Node.js`, `Express`, `Socket.io`, and `MySQL`.

## الميزات
- لوحة تحكم RTL عربية
- نظام INBOX مباشر
- إرسال تلقائي للرد الأول
- إرسال نص، صورة، صوت
- إدارة وسائط محلية
- سجل الأحداث والرسائل
- جلسة WhatsApp محلية مع `LocalAuth`
- دعم Ubuntu VPS / PM2 / headless Puppeteer

## التركيب
1. أنشئ قاعدة بيانات MySQL باسم `whatsappcrm`
2. نفذ `backend/database/schema.sql`
3. انسخ `.env.example` إلى `.env` وعاير القيم
4. نفذ `npm install`
5. شغل `npm start`

## تشغيل على PM2
```bash
pm install pm2 -g
pm start
```

## حساب المسؤول
- البريد: `admin@example.com`
- كلمة المرور: `admin123`

## ملاحظة
هذا المشروع يستخدم WhatsApp Web session محليًا.
لا يستخدم Meta Cloud API أو OpenAI.

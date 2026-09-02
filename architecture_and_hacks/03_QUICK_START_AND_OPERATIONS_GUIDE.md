# 03. Operations & Troubleshooting Quick Reference

## 🚀 Daily Operations: What Needs to Run?

| Component | Command | Location | Is it needed for WhatsApp? |
| :--- | :--- | :--- | :--- |
| **Node.js Backend & WhatsApp Gateway** | `npm run backend` | Local PC / Server | **YES.** Must be running whenever you want to send WhatsApp messages or telecast exam marksheets. |
| **Mobile App (Expo Go)** | `npm run mobile` *(or `npx expo start`)* | Local PC | **NO.** Only needed when teachers are marking attendance on their smartphones. |
| **Admin Web Portal (Cloud)** | `https://unique-scholars-attendance.vercel.app/admin` | Any Browser | Runs 24/7 on Vercel. Connects to your local gateway for dispatches. |
| **Admin Web Portal (Local)** | `http://localhost:3000/admin` | Local PC Browser | Directly connected to the local backend without going through Vercel. |

---

## 📱 How to Pair / Reconnect WhatsApp

1. Start the backend:
   ```powershell
   npm run backend
   ```
2. Open either:
   - **Admin Portal**: Go to **WhatsApp Gateway** tab -> click **Connect / View QR Code**.
   - **Mobile App**: Tap **WhatsApp** tab -> tap **⚡ Connect / View QR**.
3. Open WhatsApp on your school phone:
   - Tap **Settings** (or 3 dots) -> **Linked Devices** -> **Link a Device**.
   - Point your phone camera at the QR code on your screen.
4. Once paired, the session credentials are saved permanently in:
   [`backend/whatsapp_session/unique_scholars/creds.json`](file:///c:/Users/Zartash%20Haider/Desktop/Attendance_bot/Attendane_bot/backend/whatsapp_session/unique_scholars).
5. The session auto-restores whenever the server boots up:
   ```
   [unique_scholars] Found existing session creds. Auto-initializing WhatsApp connection...
   ✅ [unique_scholars] WhatsApp Connected Successfully!
   ```

---

## 📞 Phone Number Auto-Formatting (`formatPhoneToJid`)

In [`backend/src/services/whatsapp.js`](file:///c:/Users/Zartash%20Haider/Desktop/Attendance_bot/Attendane_bot/backend/src/services/whatsapp.js), the system automatically converts local Pakistani phone numbers into WhatsApp JIDs:

| Input in Portal | Normalized International | WhatsApp JID |
| :--- | :--- | :--- |
| `03334751998` | `923334751998` | `923334751998@s.whatsapp.net` |
| `0315-5889902` | `923155889902` | `923155889902@s.whatsapp.net` |
| `+92 333 4751998` | `923334751998` | `923334751998@s.whatsapp.net` |
| `923334751998` | `923334751998` | `923334751998@s.whatsapp.net` |

---

## 🔍 How to Telecast Exam Marksheets

1. Go to **Academic Results** -> **Marks Entry Sheet**.
2. Select **Exam Term** (e.g., *Mid Term 2026*) and **Class** (e.g., *Class Play*).
3. Review marks and remarks.
4. Click **"Finalize & Dispatch WhatsApp Marksheets"**.
5. The system will:
   - Calculate totals, percentages, class ranks (`#1`, `#2`), and grades.
   - Generate official printable PDF marksheet links.
   - Dispatch branded WhatsApp messages to every parent.
   - If dispatches are queued, the **Cloud Dispatch Sync Worker** on your PC will automatically telecast them within 4 seconds.

---

## 🛠️ Troubleshooting Guide

### 1. Toast says: *"Results locked! Queued for gateway telecast..."*
- **Meaning**: The marksheet was saved on Vercel, and messages were placed in the cloud queue.
- **Action**: Check your local backend terminal. Make sure `npm run backend` is running. You will see:
  ```
  📡 [Cloud Sync Worker] Found queued batch... Telecasting via WhatsApp...
  ✅ [Cloud Sync Worker] Successfully telecasted batch!
  ```

### 2. Chrome shows: *"unique-scholars-attendance.vercel.app wants to: Access other devices on your local network"*
- **Action**: Click **`Allow`**. This allows Chrome to make direct high-speed dispatches to your local gateway (`http://192.168.100.63:3000`). Even if you miss it, the Cloud Sync Worker will telecast the messages automatically.

### 3. WhatsApp Status shows *"Disconnected 🔴"*
- **Action**: In the **WhatsApp Gateway** tab, click **"Ping"**. If unreachable, verify that `npm run backend` is running in your terminal. If online but unlinked, click **"Connect / View QR Code"** and scan the QR code with your phone.

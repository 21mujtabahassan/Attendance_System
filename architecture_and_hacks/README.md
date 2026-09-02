# System Architecture, Tricks & Engineering Hacks
**Unique Scholars Academy — Attendance & WhatsApp Dispatch Platform**

This folder documents all the architectural decisions, bypasses, and engineering "hacks" implemented to bridge the **Vercel Serverless Cloud Deployment** with the **Persistent WhatsApp Web Engine (Baileys)** and the **React Native Mobile App (Expo)**.

---

## 📑 Index of Documentation

1. [**01_WHATSAPP_SERVERLESS_BRIDGE.md**](./01_WHATSAPP_SERVERLESS_BRIDGE.md)
   *How we solved the "0 Results Dispatched" issue on Vercel Serverless.*
   - Why Baileys WebSocket cannot run directly on Vercel.
   - **Hack 1**: Shared WhatsApp Dispatch Gateway Architecture.
   - **Hack 2**: Chrome Private Network Access (PNA) bypass (`Access-Control-Allow-Private-Network`).
   - **Hack 3**: Hybrid Client-Side Routing (Browser auto-dispatching to local IP).
   - **Hack 4**: Cloud-to-Local Auto-Telecast Queue (`pendingDispatches` + Background Sync Worker).

2. [**02_MOBILE_AND_DATA_SYNC_TRICKS.md**](./02_MOBILE_AND_DATA_SYNC_TRICKS.md)
   *How we solved stale data, disappearing updates, and student roster sync.*
   - Why student updates made in Admin Portal were not reflecting in the mobile app.
   - **Trick 1**: Vercel Serverless Ephemeral `/tmp` Storage Fallback.
   - **Trick 2**: Wi-Fi Dynamic IP Detection & Fallback (`192.168.100.63:3000`).
   - **Trick 3**: Aggressive HTTP Cache Busting (`_t=${Date.now()}` & `app.js?v=2.0.1`).
   - **Trick 4**: Real-Time Socket.IO Student Broadcasting (`students_updated`).
   - **Trick 5**: Mobile Pull-to-Refresh & Header Server Status Indicators.

3. [**03_QUICK_START_AND_OPERATIONS_GUIDE.md**](./03_QUICK_START_AND_OPERATIONS_GUIDE.md)
   *Operational cheat sheet for running the system day-to-day.*
   - What needs to be running (Backend vs. Mobile Expo).
   - How parent phone numbers are formatted (`formatPhoneToJid`).
   - Troubleshooting common network and session issues.

---

## 🏛️ High-Level System Architecture

```
                                  CLOUD ENVIRONMENT (Vercel)
               ┌──────────────────────────────────────────────────────────────┐
               │  https://unique-scholars-attendance.vercel.app               │
               │                                                              │
               │  ┌─────────────────────────┐   ┌──────────────────────────┐  │
               │  │   Admin Portal (Web)    │   │  Vercel Serverless API   │  │
               │  │   (HTML / CSS / JS)     │──►│  (/api/admin/...)        │  │
               │  └───────────┬─────────────┘   └────────────┬─────────────┘  │
               └──────────────┼──────────────────────────────┼────────────────┘
                              │                              │
               HTTP Dispatch  │ (Fallback)                   │ Queues Messages
               via Browser    │                              │ in Cloud Queue
                              ▼                              ▼
               ┌──────────────────────────────────────────────────────────────┐
               │  LOCAL PC / PERSISTENT NODE GATEWAY (Port 3000)              │
               │                                                              │
               │  ┌─────────────────────────┐   ┌──────────────────────────┐  │
               │  │  PNA CORS & Dispatch    │◄──│  Cloud Sync Worker       │  │
               │  │  Endpoints (/send, ...) │   │  (Polls Vercel Queue)    │  │
               │  └───────────┬─────────────┘   └──────────────────────────┘  │
               │              │                                               │
               │              ▼                                               │
               │  ┌────────────────────────────────────────────────────────┐  │
               │  │       Baileys Multi-Device WhatsApp Socket             │  │
               │  │       (whatsapp_session/unique_scholars/creds.json)    │  │
               │  └───────────────────────────┬────────────────────────────┘  │
               └──────────────────────────────┼───────────────────────────────┘
                                              │ Authenticated Socket Connection
                                              ▼
                                 [ WhatsApp Global Network ]
                                              │
                                              ▼
                                 [ Parent WhatsApp Phones 📲 ]
```

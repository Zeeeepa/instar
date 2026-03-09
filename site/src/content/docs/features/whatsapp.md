---
title: WhatsApp Integration
description: Full WhatsApp messaging via local Baileys library.
---

WhatsApp integration provides two-way messaging without cloud dependencies. Built on the Baileys library for local, direct WhatsApp Web connections.

## Features

- **Two-way messaging** -- Send and receive messages
- **Typing indicators** -- Shows the agent is "typing"
- **Read receipts** -- Messages are marked as read
- **Acknowledgment reactions** -- Quick feedback on received messages
- **QR code pairing** -- Scan from the web dashboard for remote setup
- **No cloud dependency** -- Direct local connection, no Meta Business API

## Setup

The setup wizard offers WhatsApp as a messaging option:

```bash
npx instar
# Choose WhatsApp when prompted
# Scan the QR code with your phone
```

## How It Works

WhatsApp messages are routed to Claude Code sessions the same way Telegram messages are. The agent responds naturally, and replies appear in WhatsApp.

The key difference from Telegram: WhatsApp doesn't have forum topics, so conversations are threaded differently internally but the user experience is seamless.

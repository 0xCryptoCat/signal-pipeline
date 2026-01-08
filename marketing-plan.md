# Alphalert Automated Marketing Pipeline (AMP) Plan

## 1. Executive Summary
The goal is to transform the "Free Channel" from a simple signal dump into a **high-conversion automated funnel**. Instead of giving away alpha for free, we use the Free Channel to provide **proof of performance**.

By automating interactions between our internal tracking engine and trusted third-party analysis bots, we generate verifiable "Social Proof" (PnL cards/images) that is far more convincing than text-based claims.

## 2. The "Loop" Architecture

The system relies on a **"Stimulus-Response-Broadcast"** loop located in the Private Discussion Group.

### Actors
1.  **Orchestrator (The Brain):** Our existing `signal-pipeline` (tracks prices/milestones internally).
2.  **The Shrills (Userbots):** Automated user accounts (MTProto) acting as marketing agents.
3.  **The Verifiers (3rd Party Bots):** External tracking bots (e.g., Proficy, safeguarding, etc.) residing in the Discussion Group.
4.  **The Stage:** The Private Discussion Group (where signals auto-post and bots live).
5.  **The Billboard:** The Free Channel.

### Workflow
1.  **Trigger:** `update-prices.js` detects Token X hit **300% (4x)** gain.
2.  **Stimulus:** The Orchestrator instructs The Shrill (Userbot) to type `/pnl <token_address>` in the Discussion Group.
3.  **Response:** The Verifier (3rd Party Bot) replies with a generated **PnL Card Image** showing the chart/gains.
4.  **Capture:** The Shrill detects the reply image from the specific bot.
5.  **Broadcast:** The Shrill forwards (or copies) the image to the Free Channel, appending a structured marketing caption with CTA buttons.

---

## 3. Content Strategy: "Proof, Hype, FOMO"

We will automate three distinct categories of content.

### A. The "Proof of Life" (Real-time PnL)
*Triggered when a token hits specific milestones (2x, 5x, 10x).*

*   **Visual:** Verified PnL Card from 3rd Party Bot (green numbers, rocket emojis).
*   **Copy Structure:**
    *   **The Hook:** "Another one strictly for the Members. 🤫"
    *   **The Meat:** "SOL Token $XYZ just smashed **350%** in 4 hours."
    *   **The Proof:** (The Image)
    *   **The CTA:** "Don't miss the next one. Join Premium 👇"
    *   **Button:** `[ 💎 Unlock Alpha Access ]`

### B. The "Daily Recap" (The Trust Builder)
*Triggered every 24h (e.g., 8 PM UTC).*

*   **Mechanism:** Orchestrator runs `/gpnl 1d` (Global PnL) via Userbot to get the "Top Calls" image from the 3rd Party Bot.
*   **Copy Structure:**
    *   **Header:** "📅 **Daily Market Scan**"
    *   **Stats:** "Today's Win Rate: **85%** | Total PnL: **+1,240%**"
    *   **Highlight:** "Top runner: $PEPE (+400%)"
    *   **Closing:** "We trade volatility while you sleep."

### C. The "FOMO Broadcast" (Scarcity & Lifestyle)
*Triggered periodically or manually.*

*   **Content:** Not chart based. Text based.
*   **Focus:** "We are closing the monthly intake soon" or "Refer 3 friends to get in for free."
*   **Subscription Integrated:** Direct links to the mechanics of the subscription bot.

---

## 4. Technical Implementation Plan

### Phase 1: The "Marketing Agent" (New Module)
We need a lightweight application (separate from the main pipeline to avoid blocking) using a Userbot library (e.g., `gramjs` or `tdlib`).

**Feature Set:**
*   **Command Runner:** Queue system to send `/pnl` commands so we don't flood the group.
*   **Listener:** Listens to the Discussion Group stream. Filters messages by:
    *   `from_id`: Must be the 3rd Party Bot ID.
    *   `reply_to_msg_id`: Must match the command we just sent.
*   **Broadcaster:** `sendMessage` / `sendPhoto` to Free Channel.

### Phase 2: Pipeline Integration
Modify `signal-pipeline` to emit events rather than just console logs.

*   In `update-prices.js` loop:
    ```javascript
    if (gains > THRESHOLD && !alreadyMarketed(token)) {
      MarketingAgent.triggerPnl(token.address, gains);
      markAsMarketed(token);
    }
    ```

### Phase 3: The Subscription Bot (Future)
*   **Payment Gateway:** Accepts SOL/ETH/USDT.
*   **Link Generation:** unique invite links that expire.
*   **Affiliate Engine:**
    *   User types `/refer`.
    *   Bot generates `t.me/AlphalertBot?start=ref_123`.
    *   If a new user pays, Ref_123 gets credit/balance.

---

## 5. Modern Telegram Marketing Tactics (2025)

1.  **The "Hidden" Content:**
    *   Use the "Spoiler" effect on the Token Ticker in the Free Channel.
    *   *Example:* "We just bought || $TRUMP || at $0.05." (Force user to tap to interact, boosts engagement metrics).

2.  **Reply Automation:**
    *   Userbot can "Reply" to the PnL image in the Free Channel 1 hour later with a "Look at it now! 🚀" update if it kept pumping. Keeps the feed alive.

3.  **Cross-Promotion Automation:**
    *   If tracking multiple chains (ETH/SOL/BASE), alternate the content so the channel feels incredibly active even if one chain is slow.

---

## 6. Development Roadmap

| Step | Task | Complexity |
| :--- | :--- | :--- |
| **1** | Set up `marketing-agent` repo with `gramjs` (Userbot). | 🟡 Medium |
| **2** | Create `CommandQueue` to safely trigger 3rd party bots. | 🟢 Easy |
| **3** | Implement "Listener" to capture the bot's image reply. | 🔴 Hard |
| **4** | Connect `signal-pipeline` events to `marketing-agent`. | 🟡 Medium |
| **5** | Design Message Templates (Hooks, Emojis, Layouts). | 🟢 Easy |
| **6** | Deploy Subscription Bot with Inline Payment buttons. | 🔴 Hard |

## 7. Immediate Next Steps (Proof of Concept)
1.  **Manual Test:** Use your personal account. Send `/pnl [address]` to the discussion group. See if the bot replies.
2.  **Capture Test:** See if we can programmatically fetch that specific reply message ID.
3.  **Forward Test:** Forward that ID to a test channel.

This architecture decouples the "Marketing" from the "Trading", allowing the Marketing Agent to be aggressive without risking the integrity of the main signal pipeline.


# AnyWareCode — Plan (Plain English)

*Product name: **AnyWareCode**. Said out loud it sounds like "anywhere code" (works anywhere, anyone on the team can use it). Written down, the "Ware" part points to software — and it quietly contains the word "aware," which fits a tool built to be careful and to check its work.*

---

## What it is, in one line

**AnyWareCode is a coding helper that lives in your Discord server. Anyone on the team can ask it to do a coding job. It writes the code, opens a pull request, and a human approves it. Everyone in the channel can watch and help.**

---

## The simple idea

Right now, AI coding tools belong to one person. They sit on one developer's computer. Each person needs their own paid account. The rest of the team can't see the work or help with it.

AnyWareCode is different. It belongs to the **whole server**, not one person:

- It lives in Discord, where your team already talks. Nothing new to learn.
- Anyone you allow can give it a coding job, just by typing in a channel.
- The work happens **in the open**, in a Discord thread. The team can watch it and steer it while it runs.
- It never changes your main code directly. It always opens a pull request, and a human decides whether to merge.
- Every pull request is **signed** — it shows who asked for it, who helped, and what was tested. No anonymous AI mess.

Think of it like the moderation bot your server already has — except this one writes code, and it puts its name on its work.

---

## Important: you bring the AI brain. We don't.

**AnyWareCode does not include an AI model and does not sell you AI usage.** You connect your own. This keeps your costs low and keeps you in control. You can connect the AI in any of these ways:

1. **API key** — paste a key from Anthropic, OpenAI, Google, or any compatible provider. You pay that provider directly for usage.
2. **A subscription you already pay for** — connect a plan like Claude Pro/Max (where the provider's terms allow it). No extra usage bill.
3. **Self-hosted / your own server** — point AnyWareCode at a model you run yourself (for example, an Ollama or vLLM endpoint, or any OpenAI-compatible URL). Your data and your model never leave your control.
4. **Any other compatible option** — if it speaks a standard API, AnyWareCode can use it.

You connect this once per server. Your credentials are encrypted and used only for that server. You can change or remove them anytime.

**What this means for the price you pay us:** because you bring the brain, we never charge you for AI usage. Our price only covers the *machinery* — running the safe sandbox, talking to GitHub, the Discord buttons and threads, keeping your settings, and so on. The AI cost is between you and your provider.

> One thing to set up properly from day one: the "connect a subscription" option depends on each provider's rules, and those rules can change. So that option is built with an on/off switch. If a provider ever changes its terms, we flip the switch off and affected servers simply switch to an API key. The product keeps working either way.

---

## How a job works (the normal flow)

1. Someone types a command in a channel, like: `/code add a dark mode toggle to the settings page`.
2. AnyWareCode opens a **thread** for that job.
3. It first shows a short **plan** ("Here's what I'll do…"). The team can give a thumbs-up, or correct it, before any real work starts.
4. It does the work inside a **safe, locked-down sandbox** (explained below). It shows progress live in the thread.
5. Anyone in the thread can jump in mid-job and add instructions ("use the v2 endpoint instead"). AnyWareCode listens and adjusts.
6. When done, it opens a **pull request** and posts a card in Discord with buttons: **Merge**, **Iterate** (fix it more), **View** (see the code), and **Preview** (see it live, if set up).
7. A human clicks **Merge**. Done — without leaving Discord.

---

## Full feature list (what each one does)

### The core: turning chat into code

**`/code` — turn a request into a pull request.**
The main feature. You type a coding job in plain language. AnyWareCode opens a thread, makes a plan, writes the code in a safe sandbox, and opens a pull request you can merge from Discord. It never touches your main branch — it always works on a separate branch and lets a human approve. This is the heart of the product.

**`/ask` — ask questions about your code.**
A read-only helper. Ask things like "how does login work in this project?" or "where is the payment logic?" and AnyWareCode answers using your actual connected code, not guesses. Because it only reads and never changes anything, it's cheap — so you get a much higher monthly allowance for asking than for coding jobs.

**Plan-first with team approval.**
Before spending an allowance on a real job, AnyWareCode posts its plan as a card. Your team approves it with a thumbs-up reaction. You choose the rule: start instantly, need one approval, or need an approval from a specific role. This stops wasted work and makes sure the team agrees before code is written.

**Live thread you can steer.**
Every job runs in its own Discord thread and streams its progress as it goes. Anyone allowed can reply in the thread to add or change instructions while it's still working — your message goes straight to AnyWareCode as a new instruction, tagged with your name. The whole team can guide it together, like pair programming.

**Iterate — fix it without starting over.**
If the pull request isn't quite right, click **Iterate**, say what's wrong, and AnyWareCode keeps working on the same branch. You go back and forth until it's right, all inside Discord.

**`@AnyWareCode` — mention it anywhere.**
You don't always need a command. Just mention AnyWareCode in a normal conversation. It reads the recent chat and figures out what you want: it might just answer you, or run a question, or run a coding job, or post a "Want me to do this? [Run] [Dismiss]" card. That card stays there — anyone allowed can click **Run** later, even days afterward.

### The safety and trust layer (our main selling point)

**Signed work — "Provenance Receipt."**
Every pull request AnyWareCode opens comes with a receipt attached. The receipt shows: **who asked** for it, **who approved** the plan, **who steered** it, and **what was tested** (which tests passed, what was checked). It links back to the public Discord thread where it all happened. This is the thing that makes AnyWareCode's work trustworthy instead of anonymous AI noise — a maintainer can show the receipt to prove exactly where a change came from.

**The human is always the gate.**
AnyWareCode can never merge code into your main branch on its own. It only opens pull requests. A human always makes the final call. Nothing from the outside world (like a stranger opening an issue) can ever start a job by itself — it can only suggest, and a trusted human has to click to run it.

**Safe, locked-down sandbox.**
Every job runs in a fresh, throwaway container that is thrown away the moment it finishes. It runs with the lowest possible permissions, with limits on how much computer power it can use. It can only talk to your AI provider and GitHub — nothing else. It holds only a short-lived key that works on one repo and then expires. Your secrets (deploy keys, billing info, your AI key) are kept *outside* this sandbox, so even if something goes wrong inside, they can't leak.

**Protection against hidden traps ("prompt injection").**
Bad actors sometimes hide secret instructions inside GitHub issues or pull request text to trick AI tools into leaking data. AnyWareCode cleans all incoming text first — it removes hidden content, treats outside text as *information to read*, not *orders to follow*, and scans it for these tricks. If it spots something suspicious, it puts a warning right on the card ("⚠️ this contains hidden instructions").

**Repro Gate — the spam filter for bug reports.**
This is the feature open-source teams will love. When someone reports a bug, AnyWareCode first **tries to reproduce it** in the sandbox before any human spends time on it. It runs the example, writes a failing test, and checks the report is even real. Then it posts a verdict: "Reproduced ✓ — here's the failing test" or "Could not reproduce ✗ — the function they mention doesn't exist in this code." This saves maintainers from drowning in fake or low-quality AI bug reports, which has become a huge problem.

### Memory and connections

**Project Memory.**
AnyWareCode remembers how your project likes to do things — your coding style, your rules ("we use pnpm, never npm"), important decisions. It reads a standard `AGENTS.md` file in your repo (the common format many AI tools now use) so its memory also works with other tools, not just ours. When you correct it twice on the same thing, it offers to save that rule for next time. Better and better over time.

**Connect your tools.**
You can plug in other services your team uses so AnyWareCode has more context — for example, your error tracker (to understand a crash), your database (to know your data shape), or your docs. These connections are set per server and locked down to only what they need.

**Preview before you merge.**
Connect a hosting service (like Vercel or Netlify) once, and every pull request card gets a **Preview** button that opens a live, temporary version of the change. This lets non-coders on the team — designers, testers, community members — actually *see* the change and check it before anyone merges. The hosting keys stay outside the sandbox for safety.

### Helpers that work in the background

**Review helper.**
AnyWareCode can review pull requests written by *humans* too. It posts a short summary, points out risky parts, and suggests tests. You can turn on auto-review so it checks every new pull request automatically. This keeps it useful even on days when nobody asks it to write code.

**Night Shift — scheduled jobs.**
Set up recurring jobs that run on a schedule: update dependencies overnight, hunt for flaky tests, write changelogs, check for outdated docs. Each morning, the results show up as "Want me to do this?" cards. Nothing gets merged without a human click — it just does the boring prep work while you sleep.

**Ship Log — show off your progress.**
Turn on a channel where every merged change gets posted as a clean announcement: what shipped, who was behind it, and a preview link. Your community sees steady progress, you get content for building in public, and every post quietly shows AnyWareCode at work.

### The fun, stand-out features

**Squad Mode — try several solutions, pick the best.**
For a tricky job, ask AnyWareCode to try it **a few different ways at once** (for example, three separate attempts). It shows the results side by side, the team **votes** with reactions, and the winning version becomes the pull request. The rest are thrown away. Great for hard problems, and a fun team moment. (Each attempt uses one job from your allowance.)

**Standup Mode — talk, and it makes a to-do.**
Turn this on and AnyWareCode can join a Discord **voice channel** during your standup or call. It listens, and afterward posts "Want me to do this?" cards for the action items it heard ("Someone mentioned the login bug — want me to look into it?"). Nothing is recorded permanently — the transcript is deleted after the cards are made, unless you pin it. This is something tools built for Slack simply can't do, because Slack has no voice culture.

**Spectate Mode — watch it work, live.**
Open a live view of a running job — the files, the changes, what it's thinking — that the whole server can watch like a stream. People can react and, if allowed, jump in. For communities it's fun and educational; for maintainers it builds trust ("I can see exactly what it did before I merge"); for you it's free marketing.

**Bounty Bridge (later).**
If your project offers paid bounties on issues, AnyWareCode surfaces those as special cards and does the starting work, so a human contributor can finish and earn the bounty. It helps people contribute and get paid, rather than replacing them. (Planned for later, not at launch.)

**Game-dev know-how (later).**
Better understanding of game engines like Godot, Unity, and Unreal — it understands scene files, knows the common code style, and can post playable test builds to a channel. Game studios live on Discord and no AI tool serves them well today. (Planned for later.)

### Admin controls

**Who can use it.** Set which Discord roles are allowed to give jobs, approve plans, or change settings.
**Which repo.** Set the active repo per channel — so one channel can work on one project, another channel on another.
**Status.** See what jobs are running or waiting in line.
**Setup & usage.** See your connections (AI provider, GitHub, hosting) and how much of your monthly allowance you've used.
**Settings dashboard.** A simple web page for managing your server's plan, connections, and settings.

---

## Pricing (still per server)

The price is **per Discord server**, not per person. That's the whole point — one price, and your whole team can use it. You bring your own AI, so **we never charge for AI usage**. Our price only covers the machinery (the safe sandbox, GitHub and Discord integration, previews, memory, and so on).

**The simple rule: every plan includes every feature. The only thing that changes is how many coding jobs you get per month.**

Nothing is locked. Squad Mode, Standup, Spectate, previews, the spam filter, signed receipts, project memory, scheduled jobs, the review helper — all of it works on every plan, including Free. We don't hold features hostage. You pay more only when your team runs *more coding jobs*, which is exactly when paying more stops hurting.

Why we do it this way: our standout features are also how the product spreads. If only top-tier servers could use Squad votes or voice standups, most of our users would never show those features off in their communities — and that's our best advertising. So everyone gets everything; the meter is simply the number of coding jobs.

| Plan | Price | Coding jobs / month | "Ask" questions | Features |
|---|---|---|---|---|
| **Free** | $0 | 15 | unlimited | **Everything.** A real, usable plan — not a crippled demo. Connect your own AI and go. |
| **Pro** | $19 / month | 150 | unlimited | **Everything.** For a small team or an active project. |
| **Studio** | $49 / month | 600 | unlimited | **Everything.** For busy teams and bigger communities. |

(One quiet, fair limit applies on every plan, including Free: **one coding job runs at a time per server**. Jobs queue up and run in order. This isn't a paywall — it's how we keep the sandbox safe and costs sane. If running several jobs at once ever becomes a real need, we'll add it as a paid add-on rather than a tier wall.)

**Add-on — Job Packs:** anyone in the server (not just the admin) can buy extra coding jobs for the whole server — for example **$8 for 50 extra jobs**. They never expire while you're subscribed, and the buyer gets a public thank-you in the server ("@maya added 50 jobs 🔋"). This does two things: it lets a busy Free or Pro server top up instead of jumping to the next plan, and it lets a whole community chip in to fund the work instead of one person paying for everything.

**Open-source plan — free, more generous:** verified public open-source projects get a bigger free job allowance (for example 40 coding jobs/month). Same as everyone — all features included — just more room, because every job they run in public is the best advertising we could ask for.

A few notes:
- **No free trial on our AI**, because we don't supply AI. Instead, the **Free plan is the trial** — it's good enough to really use. You just connect your own AI to start, which takes a minute.
- **"Ask" is unlimited on every plan.** Asking questions about your code is cheap for us (it only reads, never writes), so we don't meter it. This alone makes AnyWareCode worth adding before you run a single coding job.
- **Why this is cheap for the team:** a 5-person team paying for individual AI coding seats elsewhere spends roughly $100+/month. AnyWareCode Studio is $49 for the *whole server* — and you reuse the AI you already pay for. The savings is the pitch.

---

## Why this is hard for the big companies to copy

1. **Their money comes from per-person plans.** A "whole server for one price" product eats into that, so they're slow to build it.
2. **They're chasing big companies on Slack and Teams.** Discord communities, open-source projects, and small studios are not their focus.
3. **The trust features** (signed work, the spam filter, the human-approval rule) fit a moment where the internet is sick of anonymous AI mess. The big tools are built for raw speed, which is exactly what people are starting to distrust.
4. **The Discord-only features** (voice standups, watch-live, team votes, community funding) don't come from simply copying a Slack bot.

Honest note: none of this stops a giant forever. The goal is to become *the* coding bot of Discord before anyone bigger bothers to show up.

---

## How we get people to use it

1. **Build it in public** on the @thedslabs channel. Each stand-out feature (voice-to-task, team votes, the spam filter) is its own short demo video.
2. **Win open-source first** — but lead with the **spam filter**, not "we write AI code." The message to maintainers is "we *filter* your AI spam," which is what they actually want. Set up 10 visible projects by hand.
3. **Hackathons** — give student teams the top plan free. They'll watch it ship code all weekend and bring it to their next project.
4. **Get listed in the Discord App Directory** so people can find it.
5. **Ship Log spreads it** — every public progress post has a small "shipped with AnyWareCode" footer.

---

## Build order (simplest first)

**Phase 1 — prove the main loop.** `/code` → pull request (with Merge/Iterate/View), `/ask`, live steerable threads, the safe sandbox *with the hidden-trap protection built in from the start*, connect-your-own-AI, GitHub connection, billing, abuse protection. Get 10 servers using it every week.

**Phase 2 — make it a real teammate and win open-source.** `@mention` understanding, "Want me to do this?" cards, the bug-report spam filter (Repro Gate), signed receipts, project memory, plan votes, the review helper, the Ship Log. This is what makes people stay.

**Phase 3 — make it stand out.** Voice standups, Squad Mode (try several, vote), live previews, watch-live, scheduled night jobs, job packs, tool connections, the bigger open-source plan, game-dev know-how.

**Phase 4 — grow wider.** Bounty bridge, support for other chat apps like Telegram, support for many repos at once, a stats dashboard for teams.

---

## The pitch, in one short paragraph

> Every AI coding tool today belongs to one person, and the internet is drowning in anonymous AI mess. AnyWareCode belongs to your whole server, and it signs its work. One price for the team, and you bring your own AI. It filters junk bug reports before they waste anyone's time, turns real requests into pull requests with a name attached, lets the team vote on the best fix, listens in your standup, and lets your community help pay for it. Slack got the corporate AI tools. Discord gets the one you can trust.

---

## A note on explaining the name to users

The name is locked: **AnyWareCode**. When telling new users about it, keep the explanation light — you don't need to spell out all the wordplay. The simplest line works best:

> "AnyWareCode — it lives in your Discord and writes code for your whole team."

People will hear "anywhere code" and get it instantly. The deeper meanings (software "ware," the hidden "aware," the signed-work idea) are there for the brand to lean on later — they don't need to be explained up front.

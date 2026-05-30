---
title: Product philosophy
description: What Hoard is for and what it refuses to become — the product thesis and non-goals behind feature decisions, and where the operative list lives.
---

[Design decisions](/design-decisions/) covers *how Hoard is built and why*. This page is its sibling: *what Hoard is for and why*. If you're evaluating the project, contributing, or just curious whether a feature idea fits, this is the lens.

Hoard has a thesis: it helps you **collect games at a good price and extract or surface the value of the games you own** — quantifying a product (price-to-all-time-low, review %, $/hour, your own interest) to **inform a decision**: buy, skip, wait, or play. Every legitimate feature is a new way to surface honest value that informs a decision. The test for any new idea is one line: *does it surface honest value that informs a decision?* The format — a card, a notification, a recap, even a touch of gamification — is irrelevant; the test decides. Things that manufacture engagement without informing a decision, or dress up value that isn't real, are out.

## Why write this down

It's a small, self-hosted app, and today it has one maintainer. So why bother with a stated philosophy?

Because a public project invites drift — and that's a good thing right up until it quietly erodes what made the project worth using. New contributors and AI coding agents bring fresh ideas, but they inherit none of the unwritten judgment that shaped the existing ones. A written thesis (and an explicit set of *non-goals*) lets a new idea be judged against intent rather than vibe, and gives anyone — including the maintainer six months later — something concrete to argue *with*. A tenet that can't be challenged is dogma, not a principle, so each one ships with a "revisit signal": the condition under which it should be reopened.

## Prior art

This isn't a novel invention — it borrows a few well-worn conventions, noted here so the tenets read as deliberate rather than arbitrary:

- **Non-goals.** Projects like [Go](https://go.dev/doc/faq#Origins), Rust, and Kubernetes open design docs with an explicit *non-goals* section. Stating what you won't do is as load-bearing as stating what you will.
- **Design principles.** [Vue's Design Principles](https://vuejs.org/about/faq) and similar "philosophy" pages frame the generative thesis — what the project is *for*.
- **Tenets written to be argued with.** Amazon's working-backwards culture uses short, opinionated *tenets* that teams are expected to challenge as circumstances change. The "revisit signal" idea comes straight from that posture.

## Where the operative list lives

The tenets themselves — the thesis, the test, and the five non-goals with their revisit signals — live in [`AGENTS.md`](https://github.com/smithadifd/hoard/blob/main/AGENTS.md) at the repo root, not on this page. That's deliberate: they sit in front of every contributor and AI agent at the point of work, and keeping a single source avoids two copies drifting apart. This page exists to tell a human reader the philosophy *exists* and why; `AGENTS.md` is where you go to apply it.

# GTM Copilot MCP

## Mission

A small, safe pilot showing how a RevOps team can work with its GTM stack **through Claude, without tickets**.
It is built as a response to Krisp's Senior GTM Engineer role: email infrastructure, AI SDRs, GTM architecture,
MCP integrations, and automation that is monitored and documented.

All data is mock/synthetic. The only real external data is public DNS records.

## Core Concept

An MCP server exposes a handful of GTM tools to Claude. A RevOps person can ask:

- "Audit the sending setup for example.com." -> deliverability score and fixes
- "A new lead just came in; where did it route and why?" -> score, owner, explanation
- "Draft the first email for this lead." -> draft that passed guardrails, waiting for human approval
- "What does a meeting cost us from the AI SDR?" -> cost-per-meeting estimate

## Key Features

- **Deliverability Auditor**: SPF, DKIM, DMARC checks via DNS, with a score and prioritized fixes
- **Lead Pipeline**: webhook intake, mock enrichment (Clay-style), scoring, routing, SQLite as a stand-in CRM
- **Explainable Routing**: every decision is logged with the rules that fired
- **AI SDR Drafter**: Claude drafts, guardrails check, a human approves; nothing is sent automatically
- **Guardrails**: unsubscribe line, suppression list, approved-claims check, audit log
- **Docs**: architecture diagram, runbook, data rules

## Target Audience

1. The Krisp hiring team reviewing a pilot ahead of the home assessment.
2. A RevOps/Sales/Marketing user who wants to work with tools through Claude safely.

## Non-Goals

- No real sending of email, no real CRM credentials.
- No production claims; this is a pilot that shows judgment: when to trust an agent and when to add checks, logs and human review.

## What Success Looks Like

A reviewer clones the repo, runs one command, connects Claude to the MCP server, and in two minutes sees
an audit, a routed lead with an explanation, and a guarded draft awaiting approval. The specs show how it was built.

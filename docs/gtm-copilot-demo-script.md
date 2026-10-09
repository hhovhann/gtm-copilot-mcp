# Demo video script

The narration of [the demo video](gtm-copilot-demo.mp4), slide by slide. The voice is synthetic.

## 1. Title

This is GTM Copilot, a pilot for working with your revenue tools through Claude, safely. It uses synthetic data, and nothing is ever sent.

## 2. The problem

Revenue operations runs on tickets and guesswork. Why did this lead go to that rep? Is our email set up to reach the inbox? And an AI that writes outreach can say anything, to anyone. The goal is fewer tickets, with controls you can inspect.

## 3. The idea

There is no new interface to learn. You ask Claude in plain language, and Claude calls tools on an MCP server. Leads arrive through a small webhook, and everything lands in one database, with an audit log.

## 4. How a lead flows

When a lead arrives, the webhook checks the secret and validates it, then scores and routes it with plain rules. It stores the decision and the reason. Later, anyone can ask why, and get the answer exactly as it was decided.

## 5. Demo: deliverability

First, deliverability. I ask Claude to audit a domain. It checks SPF, DKIM and DMARC over public DNS, and returns a score, with the fixes ranked by severity.

## 6. Demo: why this route

Next, routing. Why did this lead go to mid-market, and not enterprise? The answer lists every rule that fired. A score of thirty-five, where enterprise needs sixty.

## 7. Demo: the AI SDR and its guardrails

Now the AI SDR. It drafts from approved facts only, then eight checks run in code. Here, a local model wrote an email that was only a greeting, and it was blocked. When a lead's message tried to hijack the model, the message was withheld, and the draft stayed clean.

## 8. Safe by design

The principle is simple. The model proposes, code checks, and a human decides. The model has no tools. Lead text is treated as hostile. Drafts cannot be edited after review, approval needs the exact content hash, and nothing is sent. In live runs, none of six injected drafts obeyed the attack.

## 9. Cost per meeting

Then the question your team will ask: build, buy, or hybrid? The tool compares cost per meeting, and shows where the money goes. With placeholder numbers, the options are close. In build and hybrid, human review is the biggest cost, and the model is under one percent. The real answer depends on vendor quotes and volume.

## 10. How it was built

I built it spec first. A mission, a tech stack and a roadmap, then requirements, a plan and a validation checklist for every phase. There are three hundred fifty-two tests, and I broke the security code on purpose to prove the tests catch it. Running real models found two gaps the tests had missed, and I fixed them.

## 11. What is next

With access to your stack, the next steps are connectors for HubSpot, Salesforce, Clay and Gong, a Claude drafter, and a deliverability gate on approval. The code, the specs and a runbook are on GitHub. The narration voice in this video is synthetic. Thank you.

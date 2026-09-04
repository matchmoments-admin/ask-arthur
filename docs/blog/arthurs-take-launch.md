---
title: "Arthur's Take: we stopped reposting scam reports and started explaining them"
slug: arthurs-take-launch
excerpt: "Our feed carried thousands of scam reports from around the world and added nothing to them. Now every report comes with a plain-language read of the pattern behind it — what gives it away, where it's showing up, and what it looks like in Australia."
category: product
tags: [product, arthurs-take, scam-feed, launch, scam-explainer]
hero: /illustrations/blog-product.webp
hero_alt: "Ask Arthur's scam feed, showing a pattern analysis beneath a reported scam"
---

Our scam feed had a problem we put off fixing for a long time.

It carried thousands of scam reports — people describing, in their own words, what had just happened to them. Real, useful, often distressing accounts. And we republished them as-is. A visitor got a story. They did not get any way to recognise the same thing arriving in their own inbox next week, wearing a different brand and a different name.

Today that changes. Every report in the feed that we can analyse well enough now carries **Arthur's Take**: a short read of the _pattern_, not the anecdote.

## What it actually says

Take a report about a fake process server — a caller claiming to be delivering legal documents, who then asks you to ring a different number. Here is what Arthur says about it, verbatim from the live page:

> **What gives it away**
>
> - Multiple callers reference the same case or file number, creating false consistency and authority.
> - Caller claims to be from a legal or law enforcement agency but redirects you to call a separate 'corporate centre' number.
> - Initial contact does not identify the specific legal matter or debt, asking only whether you 'received' something.
>
> **Where it's showing up**
>
> Phone calls using spoofed caller IDs; scammers impersonate legal process servers or debt collectors, using coordinated 'tag team' calls to build credibility and pressure immediate callbacks globally.

Three things you could recognise in a completely different call. That is the whole point. The person who wrote the original post is not the subject — the technique is.

## Why it isn't Australia-only

The reports we learn from are overwhelmingly not Australian. Around 98% of the scam reports in our feed come from somewhere else, mostly the United States and the United Kingdom.

We could have filtered them out. We deliberately didn't, because that is backwards. A scam that is running in Ohio this month is often running here in three. The overseas reports are an early-warning system, and throwing them away to look more local would have made us slower, not more relevant.

So every take describes the pattern globally, and adds a local line **only when there is a genuine Australian version to describe**. Sometimes that is specific:

> **In Australia**
>
> Australian rental scams appear on Domain, Realestate.com.au and Facebook Marketplace, offering rooms or units below market rent; scammers collect deposits via bank transfer from overseas or interstate tenants.

And sometimes there is nothing honest to say, in which case it says nothing. A made-up Australian angle would be worse than none.

## What we deliberately don't do

This is the section we care most about, because an automated system writing about real people's misfortune can go wrong in ways that are worse than being unhelpful.

**We never name the person.** The take describes a pattern. It is not a verdict on whoever wrote the post, and it never addresses the reader as the victim. Language like "you were scammed" is refused outright before anything is published.

**We never repeat amounts, names, handles, phone numbers or email addresses.** Every take is checked against these before it is stored, and one that carries any of them is withheld rather than shown. That check has already caught a real leak in live output.

**We are honest about what that check can't do.** It cannot recognise a personal name written as ordinary prose, and it cannot spot a username with no `@` in front of it. No pattern match can. So a person reviews the takes, and a single click pulls one down. We would rather tell you where the net has holes than imply it has none.

**We don't show a take when we aren't confident.** Around one in six is withheld — too thin a source post, a label the classifier wasn't sure about, or a post that isn't really a scam report at all. A confident-sounding paragraph built on a shaky reading is worse than a blank space.

**We don't republish the original post.** You get the same short excerpt the feed has always shown, and a prominent link to the source. The analysis is ours; the story stays where its author put it.

## What this is really for

Reading one scam report teaches you about one scam. Reading the pattern behind a thousand of them teaches you what to look for.

That is the thing we can do that an individual reading Reddit cannot: we already analyse every report that comes through, extract the technique, the tactics and the brands being impersonated, and cluster them. That analysis has been quietly running for months, feeding our brand watchlist and our threat intelligence. Until today, none of it was written for a human to read.

## What's next

Three things, in order.

**More coverage.** Around 870 reports carry a take today. The rest of the archive is being worked through, and every new report gets one automatically.

**Reverse lookup.** When you paste something into the scanner, we want to be able to say "fourteen people reported something like this in the last month, and here is what they had in common". The data for that already exists.

**Your judgement, not just ours.** Each take will carry a way to tell us it is wrong. The point of publishing our reasoning is that it can be argued with.

---

If something has just landed in your inbox and you want a second opinion before you click, that is what the scanner is for. And if you have been caught, you have not done anything stupid — these techniques are engineered by people who do this full time, and being targeted is not a character flaw.

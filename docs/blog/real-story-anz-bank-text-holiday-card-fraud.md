Last week, my girlfriend received a text that looked exactly like every other bank scam we warn people about.

It came from a number we didn't recognise. It claimed to be ANZ. It said her card had been temporarily blocked after a suspicious transaction — $866.17 to a hotel via Booking.com in Sydney. It asked her to reply 1 for yes, 2 for no.

She did the right thing. She opened Ask Arthur and scanned it.

What happened next is why we're publishing this — because the answer was more useful than just _"yes, that's a scam."_

---

## The text

> _"From ANZ: Hi [NAME] — It is important that you confirm whether you attempted this transaction: $866.17 to Hotel at Booking.com Sydney AU on 20-Mar. Your card ending [XXXX] remains temporarily blocked as a precaution and to protect your money. Please confirm if this was you. Reply 1 if YES or 2 if NO."_

Standard format. A named card. A specific amount. A deadline pressure built in. Exactly what a well-crafted phishing SMS looks like.

---

## What Arthur said

Arthur flagged it as **High Risk — Likely a Scam**. 95% confidence.

The reasoning was solid: impersonation of a major Australian bank, a callback number not registered to ANZ, pressure to reply immediately. All the hallmarks.

But there was a second line in the result that mattered just as much:

> _"Do not reply, click any links, or call the number shown. Contact ANZ directly using their official number."_

That instruction — contact the real provider directly — turned out to be the most important thing Arthur said.

---

## We checked anyway

> [!DANGER]
> Rather than ignoring the text and moving on, she opened the ANZ app and looked at her actual transactions. The $866 Booking.com charge from the text wasn't there. But a cluster of pending transactions totalling **close to A$4,000** was — none of which she had authorised. The scam text was fake. The fraud underneath was real.

Rather than ignoring the text and moving on, she opened the ANZ app and looked at her actual transactions.

The $866 Booking.com charge from the text? Not there.

But other charges were. Small ones from places she didn't recognise. And a cluster of pending transactions totalling close to $4,000 that had no business being there.

She called ANZ directly. Not the number in the text — the one on the back of her card.

---

## The call

It wasn't quick. We were up late while ANZ worked through the account, investigated the charges, and figured out how it happened.

What they found: the card had already been blocked automatically. ANZ's own fraud detection had flagged the unusual activity before she even rang. Every pending fraudulent charge — nearly $4,000 in total — was reversed. The card was cancelled, a new one issued.

The only thing she could piece together was using her physical card at a few small shops while on holiday recently. That's probably all it took. A card reader at a café, a boutique, somewhere unremarkable. Card details skimmed or captured somewhere they shouldn't have been.

---

## What this means for how Arthur works

We'll be direct: this case revealed something we needed to fix.

> [!WARNING]
> The text _did_ look like a scam. Arthur was right to flag it. But the underlying situation — a real bank detecting real unauthorised charges — was genuine. The risk isn't just _"is this a scam?"_ anymore. It's _"even if this looks like a scam, does it point to something real I should check?"_ That's a category of false-negative we hadn't built for.

Going forward, when Arthur detects messages that appear to impersonate a known service — bank, telco, government, delivery company, any real provider — the result will include a clearer prompt:

> _"This looks like a scam. But if it mentions a service you actually use, check the official app or website directly, review your recent transactions, and contact the provider using the number or address on their official site — not anything in this message."_

That wording protects you in both cases. If it's a scam: you haven't engaged with it. If it's real: you've caught something before it gets worse. We've already shipped the change.

---

## Practical takeaways

> [!TIP]
> The right response to any suspicious bank text: **don't click, don't call the number in the message, don't reply**. Open your banking app directly. Look at your transactions. If something's wrong, call the number on the back of your card. Two steps that work whether the message is fake or real.

**Use Apple Pay or Google Pay wherever possible.** When you tap to pay with your phone, the merchant never sees your actual card number. It uses a one-time token. It can't be skimmed the same way a physical card can. Not perfect, but a meaningful step up — especially when travelling.

**Check your banking app regularly, not just when prompted.** Fraudulent charges often start small. A few dollars here, a pending transaction there. By the time something large appears, the card details have already been tested and confirmed.

**Save your bank's fraud line as a contact now.** CommBank **13 2221**, Westpac **132 032**, NAB **13 22 65**, ANZ **13 33 50**, Macquarie **1800 622 742**. The five seconds it takes to add the contact is the difference between calling immediately and Googling for the number under stress.

**If you've travelled recently and used a physical card, watch the next two billing cycles.** Skimmed details often get tested at the merchant level before being used. Anything unfamiliar, dispute immediately — Australian banks honour disputes under the **ePayments Code** when reported promptly.

---

## One more thing

ANZ blocked the card automatically. They reversed the charges. They stayed on the phone until everything was sorted.

The text itself could use some work — asking customers to reply 1 or 2 to a fraud alert will always look suspicious to anyone who's been told not to engage with unknown numbers. Worth considering a prompt to check the app instead.

But the fraud detection behind it worked exactly as it should.

Thank you, ANZ.

---

_If you've received a suspicious bank text or email, don't reply or click any links. Open your banking app directly to verify, and call your bank's fraud line on the number on the back of your card. To report scam texts to Scamwatch, forward them to 0429 401 703 or visit scamwatch.gov.au._

_Ask Arthur is Australia's friendly scam-detection companion, built locally with Australian threat intelligence. For more guides and real-time alerts, visit askarthur.au._

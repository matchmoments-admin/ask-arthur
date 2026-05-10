import styles from "./investors.module.css";

export default function InvestorsPage() {
  return (
    <div className={styles.shell}>
      <main className={styles.page}>
        {/* ===== MASTHEAD ===== */}
        <header className={styles.masthead}>
          <div className={styles.metaLeft}>
            Vol. 1, No. 1
            <br />
            <b>Sydney · Australia</b>
          </div>
          <div className={styles.wordmark}>
            <div className={styles.kicker}>
              Investor one-pager · Menlo Anthology Fund
            </div>
            <div className={styles.name}>
              Ask <em>Arthur</em>
            </div>
            <div className={styles.tag}>
              A free, private second opinion on anything that smells like a
              scam.
            </div>
          </div>
          <div className={styles.metaRight}>
            Submitted May 2026
            <br />
            <b>askarthur.au</b>
          </div>
        </header>

        <div className={styles.strip}>
          <span>
            <b>Stage</b> &nbsp; Pre-seed
          </span>
          <span>
            <b>Sector</b> &nbsp; Consumer Trust &amp; Safety · AI
          </span>
          <span>
            <b>Geography</b> &nbsp; ANZ → Global English
          </span>
          <span>
            <b>Model</b> &nbsp; Claude (primary)
          </span>
        </div>

        {/* ===== LEDE ===== */}
        <section className={styles.lede}>
          <div>
            <h1>
              Australians lost <em>A$2.7B</em> to scams last year. Most of it
              started with a message they weren&apos;t sure about.
            </h1>
            <p className={styles.deck}>
              Ask Arthur is the friend you forward the suspicious text to —
              except this friend never sleeps, never judges, never stores the
              message, and is right almost every time. Paste a message, email,
              link, screenshot, or phone number. In seconds, Arthur returns a
              clear verdict, the signals that triggered it, and what to do
              next. No sign-up. No cost.
            </p>
          </div>
          <aside className={styles.askCard}>
            <div className={styles.askCardLabel}>The ask</div>
            <div className={styles.askCardHeadline}>
              <em>First cheque.</em>
              <br />
              Open to terms.
            </div>
            <div className={styles.askCardSub}>
              Pre-seed · solo founder · capital-efficient by design.
            </div>
            <div className={styles.breakdown}>
              <div className={styles.breakdownCap}>
                How any cheque gets spent
              </div>
              <div className={styles.breakdownRow}>
                <span>Engineering &amp; ML</span>
                <b>55%</b>
              </div>
              <div className={styles.breakdownRow}>
                <span>Distribution &amp; partnerships</span>
                <b>25%</b>
              </div>
              <div className={styles.breakdownRow}>
                <span>Compliance &amp; trust ops</span>
                <b>15%</b>
              </div>
              <div className={styles.breakdownRow}>
                <span>Founder runway</span>
                <b>5%</b>
              </div>
            </div>
          </aside>
        </section>

        {/* ===== SECTION 1 — THE PROBLEM ===== */}
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadNum}>§ 01</div>
          <h2>The problem we picked</h2>
          <div className={styles.sectionHeadRule} />
        </div>

        <section className={styles.columns}>
          <div className={styles.col}>
            <div className={styles.iconMark}>Scale</div>
            <h3>The blast radius is global, the defence is personal.</h3>
            <p>
              Scam volume has roughly doubled every two years on the back of
              the same generative tools that power our product. Voice cloning,
              AI-written phishing, fake invoices and SMS lures all converge on
              one fragile checkpoint: a person, in a moment of doubt, alone
              with a screen.
            </p>
          </div>
          <div className={styles.col}>
            <div className={styles.iconMark}>Status quo</div>
            <h3>Government hotlines are slow. Banks act after the fact.</h3>
            <p>
              Scamwatch and bank fraud teams do important work, but they
              activate <em>after</em> a victim is hooked. There is no fast,
              low-friction tool a person can reach for in the ten seconds
              between &ldquo;this looks weird&rdquo; and clicking the link.
            </p>
          </div>
          <div className={styles.col}>
            <div className={styles.iconMark}>Our wedge</div>
            <h3>
              A neutral, free, private check — built for the moment of doubt.
            </h3>
            <p>
              Arthur sits in that ten-second gap. It is intentionally
              unauthenticated, intentionally free, intentionally
              Australian-toned, and intentionally narrow: it is not a security
              suite, it is the second opinion you wish you had a smart friend
              for.
            </p>
          </div>
        </section>

        {/* ===== STATS ===== */}
        <section className={styles.stats}>
          <div className={styles.stat}>
            <div className={styles.statNum}>
              A$2.7<span>B</span>
            </div>
            <div className={styles.statLabel}>Reported losses · ANZ 2024</div>
            <div className={styles.statSrc}>ACCC Targeting Scams Report</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statNum}>
              601<span>K</span>
            </div>
            <div className={styles.statLabel}>
              Scam reports lodged with Scamwatch
            </div>
            <div className={styles.statSrc}>FY24 · est.</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statNum}>
              73<span>%</span>
            </div>
            <div className={styles.statLabel}>
              of Australians targeted in past 12 months
            </div>
            <div className={styles.statSrc}>ACMA consumer survey</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statNum}>8</div>
            <div className={styles.statLabel}>
              Detection surfaces shipped to date
            </div>
            <div className={styles.statSrc}>
              Web · Extension · iOS · Android · API
            </div>
          </div>
        </section>

        {/* ===== SECTION 2 — THE PRODUCT ===== */}
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadNum}>§ 02</div>
          <h2>What we&apos;ve shipped</h2>
          <div className={styles.sectionHeadRule} />
        </div>

        <section className={styles.product}>
          <div className={styles.productText}>
            <p>
              Arthur is live at <b>askarthur.au</b>. The core experience is one
              input box. Paste text, drop an image, share a link, or forward a
              phone number. A Claude-orchestrated pipeline classifies the
              artefact, enriches it against fraud databases, runs targeted
              checks (URL reputation, header analysis, OCR, persona
              consistency, breach exposure), and returns a structured verdict
              in plain English.
            </p>
            <ul className={styles.productList}>
              <li>
                <span className={styles.k}>Scanner</span>
                <span>
                  <b>Free message, link &amp; image checker.</b> Multi-modal
                  input. No sign-up. Messages discarded after analysis.
                </span>
              </li>
              <li>
                <span className={styles.k}>Companion</span>
                <span>
                  <b>Persona, phone footprint, charity check, breach defence.</b>{" "}
                  Five purpose-built modules for the questions Australians
                  Google in panic.
                </span>
              </li>
              <li>
                <span className={styles.k}>Surfaces</span>
                <span>
                  <b>Web, browser extension, iOS, Android.</b> Same engine,
                  shipped wherever the suspicious message arrives.
                </span>
              </li>
              <li>
                <span className={styles.k}>API</span>
                <span>
                  <b>Developer endpoint.</b> Same engine, embeddable in banking
                  apps, telcos, and marketplace flows.
                </span>
              </li>
            </ul>
          </div>
          <div className={styles.productVisual}>
            <div className={styles.visualCap}>
              — Live verdict, edited for length
            </div>
            <div className={styles.verdict}>
              <div className={styles.submitted}>
                SMS · submitted 14:02 AEST
              </div>
              <p className={styles.quote}>
                &ldquo;AusPost: your parcel could not be delivered due to an
                unpaid customs fee of $3.40. Please update your details within
                24 hours: aus-post-redelivery.co/track …&rdquo;
              </p>
              <div className={styles.ruling}>
                <span className={styles.dot} />
                <span className={styles.word}>Almost certainly a scam.</span>
                <span className={styles.conf}>CONF · 0.97</span>
              </div>
              <ul className={styles.signals}>
                <li>
                  Domain registered 6 days ago via a bulk reseller; not an
                  Australia Post property.
                </li>
                <li>
                  Urgency framing + small-fee bait is a known parcel-redelivery
                  pattern (1,200+ matches this week).
                </li>
                <li>
                  Australia Post does not request payment by SMS link. Don&apos;t
                  tap. Forward to 7226 and delete.
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ===== SECTION 3 — TRACTION + ROADMAP ===== */}
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadNum}>§ 03</div>
          <h2>Where we are, where the cheque takes us</h2>
          <div className={styles.sectionHeadRule} />
        </div>

        <section className={styles.split}>
          <div className={styles.splitLeft}>
            <ul className={styles.tractionList}>
              <li>
                <span className={styles.tractionBig}>Solo</span>
                <span className={styles.tractionDesc}>
                  <b>One technical founder, A$0 raised.</b> Live since February
                  2026. The product you see at askarthur.au is what one person
                  ships in a Sydney winter when they&apos;re very, very annoyed.
                </span>
              </li>
              <li>
                <span className={styles.tractionBig}>16</span>
                <span className={styles.tractionDesc}>
                  <b>Active threat-intelligence feeds</b> ingesting daily —
                  Scamwatch, ACSC, ASIC, Reddit narrative-extraction, AU
                  regulator scrapes — into a unified Postgres + pgvector
                  index.
                </span>
              </li>
              <li>
                <span className={styles.tractionBig}>63K</span>
                <span className={styles.tractionDesc}>
                  <b>Australian charities indexed</b> via daily ACNC diff. The
                  most complete consumer-facing charity-verification dataset
                  I&apos;m aware of, powering the &ldquo;is this fundraiser
                  real?&rdquo; flow.
                </span>
              </li>
              <li>
                <span className={styles.tractionBig}>8</span>
                <span className={styles.tractionDesc}>
                  <b>Detection surfaces shipped:</b> web scanner, persona
                  check, phone footprint, charity check, breach defence,
                  Chrome/Firefox extension, iOS, Android.
                </span>
              </li>
              <li>
                <span className={styles.tractionBig}>A$0</span>
                <span className={styles.tractionDesc}>
                  <b>Cost to the user, ever.</b> Revenue comes from the API and
                  institutional partnerships, never from the public tool.
                </span>
              </li>
            </ul>
          </div>
          <div className={styles.splitRight}>
            <div className={styles.roadmap}>
              <div className={styles.phase}>
                <div className={styles.phaseWhen}>M 0–3</div>
                <div>
                  <h4>Voice &amp; phone-call checks</h4>
                  <p>
                    Forward a voicemail or live-call snippet; Arthur returns
                    voice-clone likelihood and known-bad-number signals.
                  </p>
                </div>
              </div>
              <div className={styles.phase}>
                <div className={styles.phaseWhen}>M 3–6</div>
                <div>
                  <h4>Distribution &amp; native share-sheet</h4>
                  <p>
                    Long-press any message → &ldquo;Ask Arthur.&rdquo; Browser
                    extension store push, AU consumer-affairs partnerships, and
                    polished mobile share-sheet.
                  </p>
                </div>
              </div>
              <div className={styles.phase}>
                <div className={styles.phaseWhen}>M 6–12</div>
                <div>
                  <h4>First paid pilot</h4>
                  <p>
                    Embed Arthur in a transfer-confirmation or unknown-caller
                    flow with an Australian bank or telco. Land one institutional
                    partner; convert to revenue.
                  </p>
                </div>
              </div>
              <div className={styles.phase}>
                <div className={styles.phaseWhen}>M 12–18</div>
                <div>
                  <h4>UK &amp; Canada launch</h4>
                  <p>
                    Same regulatory shape, same scam playbooks, same English.
                    The product is 90% there on day one.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== SECTION 4 — TEAM + QUOTE ===== */}
        <section className={styles.footerGrid}>
          <div className={styles.pullQuote}>
            <div className={styles.pullQuoteMark}>&ldquo;</div>
            <blockquote>
              We are not building a security product. We are building the
              friend your mother wishes she could call before she clicks. Claude
              is the only model good enough — and patient enough — to play that
              role at scale.
            </blockquote>
            <cite>
              — <b>Founder&apos;s note</b> · why we want Anthology, specifically
            </cite>
          </div>
          <div className={styles.team}>
            <div className={styles.teamHead}>Team · §04</div>
            <div className={styles.person}>
              <div className={styles.personName}>Brendan Milton</div>
              <div className={styles.personRole}>
                Founder · Engineering · Sole operator
              </div>
              <p className={styles.personBio}>
                Sydney-based, technical. Built Ask Arthur solo since February
                2026 — eight detection surfaces (scanner, persona check, phone
                footprint, charity check, breach defence, browser extension,
                iOS, Android) running on a Claude-orchestrated pipeline.
                Looking for an investor who funds builders before traction.
              </p>
            </div>
            <div className={styles.person}>
              <div className={styles.personName}>Hiring next</div>
              <div className={styles.personRole}>With a first cheque</div>
              <p className={styles.personBio}>
                A commercial co-founder, an applied-ML engineer, and an advisor
                with policy / regulator relationships. The technical surface is
                already deeper than the team — that asymmetry is what the round
                fixes.
              </p>
            </div>
          </div>
        </section>

        {/* ===== COLOPHON ===== */}
        <footer className={styles.colophon}>
          <div className={styles.colophonLeft}>
            <b>Ask Arthur Pty Ltd</b> · ABN 72 695 772 313 · Sydney NSW
            <br />
            <a href="https://askarthur.au">askarthur.au</a> ·{" "}
            <a href="mailto:hello@askarthur.au">hello@askarthur.au</a> ·{" "}
            <a href="https://askarthur.au/api-docs">/api-docs</a>
            <br />
            Independent cybersecurity advisory tool. Not affiliated with the
            Australian Government.
          </div>
          <div className={styles.signoff}>
            <div className={styles.stamp}>
              For the Anthology Fund<span>Menlo &times; Anthropic</span>
            </div>
          </div>
        </footer>

        <div className={styles.smallprint}>
          One page · Prepared for Menlo Ventures &amp; Anthropic · Confidential
          draft, May 2026
        </div>
      </main>
    </div>
  );
}

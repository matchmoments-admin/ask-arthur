/**
 * "Modern LinkedIn monthly report" ledger design for the Clone-Watch carousel,
 * ported from the user's claude.ai/design project (Option 1B - Ledger). Warm
 * editorial palette (paper + navy + terracotta), Archivo + JetBrains Mono,
 * column-grid cards with header rules and page numbers.
 *
 * Kept as an injected TS string (not a global stylesheet) so it stays scoped to
 * this internal screenshot surface. Fonts come from next/font (CSP-safe).
 */
export const reportCardCss = `
.rc-root{
  --paper:#F7F5EE; --canvas:#E6E4DC; --ink:#0C2440; --body:#33465A; --sub:#5F6E7C;
  --muted:#8493A0; --muted2:#6B7887; --line:rgba(12,36,64,0.14); --grid:rgba(12,36,64,0.032);
  --rust:#B54225; --orange:#D8613A; --pageTot:#B4BCB0;
  font-family:var(--font-archivo),"Helvetica Neue",Arial,system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;
}
.rc-root *{box-sizing:border-box;}
.rc-root .mono{font-family:var(--font-jbmono),ui-monospace,Menlo,monospace;}

/* solo (?slide=N): one slide full-bleed over the admin shell for clean export */
.rc-root.rc-solo{position:fixed;inset:0;z-index:99999;background:var(--paper);}
.rc-root:not(.rc-solo){display:flex;flex-direction:column;align-items:center;gap:26px;padding:28px 16px 60px;background:var(--canvas);min-height:100vh;}

.rc-root .slide{position:relative;width:1080px;height:1350px;padding:84px 84px 72px;display:flex;flex-direction:column;
  color:var(--ink);background-color:var(--paper);
  background-image:repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px 156px);overflow:hidden;}
.rc-root:not(.rc-solo) .slide{box-shadow:0 30px 80px rgba(0,0,0,0.16);}

/* header rule */
.rc-root .hdr{display:flex;align-items:center;justify-content:space-between;padding-bottom:22px;border-bottom:2px solid var(--ink);}
.rc-root .hdr .l{font-family:var(--font-jbmono),monospace;font-size:23px;font-weight:700;letter-spacing:.26em;color:var(--ink);}
.rc-root .hdr .r{font-family:var(--font-jbmono),monospace;font-size:22px;letter-spacing:.2em;color:var(--muted2);}

/* footer + page number */
.rc-root .foot{margin-top:auto;padding-top:26px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;}
.rc-root .foot.rule2{border-top:2px solid var(--ink);}
.rc-root .foot.bot{align-items:flex-end;gap:24px;}
.rc-root .brandline{font-size:26px;color:var(--ink);}
.rc-root .brandline b{font-weight:800;} .rc-root .brandline span{color:var(--muted2);}
.rc-root .page{font-family:var(--font-jbmono),monospace;font-size:24px;letter-spacing:.1em;color:var(--ink);flex-shrink:0;}
.rc-root .page .tot{color:var(--pageTot);}

/* card 1 - hook */
.rc-root .eyebrow{font-family:var(--font-jbmono),monospace;font-size:26px;letter-spacing:.16em;color:var(--rust);margin-bottom:6px;}
.rc-root .hero{margin-top:120px;}
.rc-root .heronum{font-size:304px;line-height:0.82;font-weight:900;letter-spacing:-0.035em;color:var(--ink);}
.rc-root .herobar{width:280px;height:12px;background:var(--orange);margin:20px 0 34px;}
.rc-root .lead{margin:0;max-width:920px;font-size:42px;line-height:1.28;font-weight:500;color:var(--body);}
.rc-root .lead b{color:var(--ink);font-weight:800;}
.rc-root .kpis{margin-top:60px;display:flex;border-top:2px solid var(--ink);padding-top:32px;}
.rc-root .kpi{flex:1;padding:0 36px;border-left:1px solid rgba(12,36,64,0.18);}
.rc-root .kpi:first-child{padding-left:0;padding-right:36px;border-left:none;}
.rc-root .kpi:last-child{padding-right:0;}
.rc-root .kpi .n{font-size:74px;font-weight:800;line-height:1;color:var(--ink);}
.rc-root .kpi.accent .n{color:var(--rust);}
.rc-root .kpi .l{margin-top:14px;font-size:24px;color:var(--sub);line-height:1.3;}
.rc-root .note{font-family:var(--font-jbmono),monospace;margin-top:26px;max-width:860px;font-size:22px;line-height:1.5;color:var(--muted);}

/* card 2 - data (spacing tightened so 8 rows + globals + footer fit 1350px) */
.rc-root .h2{margin:34px 0 10px;font-size:68px;line-height:0.99;font-weight:900;letter-spacing:-0.03em;color:var(--ink);}
.rc-root .subhead{font-size:28px;color:#5B6B7B;font-weight:500;}
.rc-root .rows{margin-top:30px;display:flex;flex-direction:column;}
.rc-root .row{display:flex;align-items:center;gap:30px;padding:14px 0;border-top:1px solid var(--line);}
.rc-root .row:last-child{border-bottom:1px solid var(--line);}
.rc-root .row .name{width:300px;font-size:32px;font-weight:700;}
.rc-root .track{flex:1;height:22px;background:rgba(12,36,64,0.06);position:relative;}
.rc-root .fill{position:absolute;top:0;bottom:0;left:0;background:var(--ink);}
.rc-root .fill.accent{background:var(--orange);}
.rc-root .val{width:70px;text-align:right;font-size:38px;font-weight:800;}
.rc-root .val.accent{color:var(--rust);}
.rc-root .globals{margin:24px 0 0;font-size:28px;line-height:1.4;color:var(--ink);}
.rc-root .globals b{font-weight:800;}
.rc-root .reg{font-family:var(--font-jbmono),monospace;font-size:21px;line-height:1.4;color:var(--muted);max-width:660px;}

/* card 3 - takeaway */
.rc-root .h2b{margin:46px 0 44px;font-size:84px;line-height:1.0;font-weight:900;letter-spacing:-0.03em;color:var(--ink);}
.rc-root .steps{display:flex;flex-direction:column;}
.rc-root .step{display:flex;gap:32px;padding:26px 0;border-top:1px solid var(--line);}
.rc-root .step:last-child{border-bottom:1px solid var(--line);}
.rc-root .step .sn{font-family:var(--font-jbmono),monospace;font-size:26px;font-weight:700;color:var(--rust);padding-top:6px;}
.rc-root .step p{margin:0;font-size:37px;line-height:1.3;color:var(--body);font-weight:500;}
.rc-root .step b{color:var(--ink);font-weight:800;}
.rc-root .know{margin-top:40px;border-left:4px solid var(--orange);padding-left:26px;}
.rc-root .know .lab{font-family:var(--font-jbmono),monospace;font-size:21px;letter-spacing:.14em;color:var(--rust);margin-bottom:12px;}
.rc-root .know .txt{font-family:var(--font-jbmono),monospace;font-size:22px;line-height:1.6;color:var(--sub);}
.rc-root .close{margin-top:auto;}
.rc-root .cta{font-size:58px;font-weight:900;letter-spacing:-0.02em;line-height:1.06;color:var(--ink);}
.rc-root .cta a{display:inline-block;color:var(--rust);text-decoration:none;}
.rc-root .partner{margin:20px 0 0;font-size:25px;line-height:1.5;color:var(--sub);max-width:940px;}
.rc-root .partner b{color:var(--ink);font-weight:700;}
.rc-root .partner a{color:var(--rust);font-weight:700;text-decoration:none;}

/* card 1 - hook now stands alone (KPIs moved to "what we did"), so it gets more air */
.rc-root .hero.hero-lg{margin-top:150px;}

/* card 2 - scale + month-on-month delta */
.rc-root .momrow{display:flex;align-items:flex-end;gap:34px;margin-top:34px;}
.rc-root .mombig{font-size:214px;line-height:0.82;font-weight:900;letter-spacing:-0.035em;color:var(--ink);}
.rc-root .delta{font-family:var(--font-jbmono),monospace;font-size:46px;font-weight:700;line-height:1;padding:14px 24px;border:3px solid;margin-bottom:24px;white-space:nowrap;}
.rc-root .delta.up{color:var(--rust);border-color:var(--rust);}
.rc-root .delta.down{color:#2E7D5B;border-color:#2E7D5B;}
.rc-root .delta.flat{color:var(--muted2);border-color:var(--line);}
.rc-root .cmpline{margin:32px 0 0;font-size:34px;line-height:1.35;color:var(--body);font-weight:500;max-width:920px;}
.rc-root .cmpline b{color:var(--ink);font-weight:800;}
.rc-root .baseline{margin:38px 0 0;border-left:4px solid var(--orange);padding-left:26px;font-size:38px;line-height:1.3;color:var(--body);font-weight:500;max-width:880px;}
.rc-root .baseline b{color:var(--ink);font-weight:800;}
.rc-root .statstrip{margin-top:auto;display:flex;border-top:2px solid var(--ink);padding-top:32px;}
.rc-root .statstrip .st{flex:1;padding:0 34px;border-left:1px solid rgba(12,36,64,0.18);}
.rc-root .statstrip .st:first-child{padding-left:0;border-left:none;}
.rc-root .statstrip .st .n{font-size:70px;font-weight:800;line-height:1;color:var(--ink);}
.rc-root .statstrip .st .n.accent{color:var(--rust);}
.rc-root .statstrip .st .l{margin-top:14px;font-size:24px;color:var(--sub);line-height:1.3;}

/* card 6 - registrar names run longer than brand names: shrink + ellipsis */
.rc-root .row .name.reg-name{font-size:26px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
`;

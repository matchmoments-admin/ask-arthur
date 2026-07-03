/**
 * Swiss deck styling for the report-card slides, ported verbatim from the
 * verified carousel (matches apps/web/public/overview.html tokens). Kept as a
 * TS string (not a .css file) so it can be injected inline into the server
 * component without a global stylesheet — the page is a one-off internal
 * screenshot surface, so scoping everything under `.rc-root` avoids leaking
 * these rules into the rest of /admin.
 *
 * Fonts come from next/font (Archivo + IBM Plex Mono) via CSS variables set on
 * .rc-root, so there is no external Google Fonts request (CSP-safe).
 */
export const reportCardCss = `
.rc-root{--bg:#FCFCFA;--ink:#0C2340;--body:#3F5169;--muted:#6B7789;--navy:#0C2340;--green:#16A06A;--green-b:#27C083;--line:#E1E6EE;--card:#FBFCFE;--grid:rgba(12,35,64,.055);--grid-d:rgba(255,255,255,.06);--lt-txt:#F4F7FB;--lt-body:#C3D0E0;--lt-muted:#9FB2C9;
  font-family:var(--font-archivo),"Helvetica Neue",Arial,system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;}
.rc-root *{box-sizing:border-box;}
.rc-root .mono{font-family:var(--font-plex-mono),ui-monospace,Menlo,monospace;}
/* solo (?slide=N): one slide, full-bleed over the admin shell for clean export */
.rc-root.rc-solo{position:fixed;inset:0;z-index:99999;background:#fff;}
.rc-root:not(.rc-solo){display:flex;flex-direction:column;align-items:center;gap:24px;padding:28px 16px 60px;background:#E9ECF1;min-height:100vh;}
.rc-root .slide{position:relative;width:1080px;height:1350px;background:var(--bg);color:var(--ink);overflow:hidden;}
.rc-root:not(.rc-solo) .slide{box-shadow:0 18px 50px rgba(12,35,64,.14);}
.rc-root .slide.dk{background:var(--navy);color:var(--lt-txt);}
.rc-root .pad{position:absolute;inset:0;padding:84px 84px;display:flex;flex-direction:column;}
.rc-root .go{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:calc(100%/6) 100%;}
.rc-root .dk .go{background-image:linear-gradient(90deg,var(--grid-d) 1px,transparent 1px);}
.rc-root .eb{display:flex;align-items:center;gap:16px;}
.rc-root .eb .bar{width:52px;height:14px;background:var(--navy);}
.rc-root .dk .eb .bar{background:var(--green-b);}
.rc-root .eb .num{font-size:19px;font-weight:600;letter-spacing:.14em;color:var(--navy);}
.rc-root .dk .eb .num{color:#fff;}
.rc-root .eb .lab{font-size:19px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);}
.rc-root .dk .eb .lab{color:var(--lt-muted);}
.rc-root h2{margin:0;font-weight:800;font-size:60px;line-height:1.02;letter-spacing:-.03em;}
.rc-root .dk h2{color:var(--lt-txt);}
.rc-root .kicker{font-family:var(--font-plex-mono),monospace;font-size:18px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:0;}
.rc-root .kicker.gb{color:var(--green-b);}
.rc-root .lead{font-size:26px;line-height:1.45;color:var(--body);font-weight:500;margin:0;}
.rc-root .lead.lb{color:var(--lt-body);}
.rc-root .lead b{color:var(--ink);}
.rc-root .dk .lead b,.rc-root .lead.lb b{color:#fff;}
.rc-root .lead b.ink{color:var(--ink);}
.rc-root .big{font-family:var(--font-plex-mono),monospace;font-weight:600;font-size:210px;line-height:.86;letter-spacing:-.04em;color:#fff;}
.rc-root .accent{color:var(--green);}
.rc-root .dk .accent{color:var(--green-b);}
.rc-root .spacer{flex:1 1 auto;}
.rc-root .note{font-size:17px;color:var(--lt-muted);line-height:1.5;max-width:860px;}
.rc-root .disc{font-size:14px;color:var(--lt-muted);margin-top:24px;line-height:1.5;max-width:900px;}
.rc-root .foot{display:flex;justify-content:space-between;align-items:center;font-family:var(--font-plex-mono),monospace;font-size:16px;letter-spacing:.05em;color:var(--muted);border-top:1px solid var(--line);padding-top:20px;margin-top:22px;}
.rc-root .dk .foot{color:var(--lt-muted);border-top-color:rgba(255,255,255,.16);}
.rc-root .foot b{color:var(--ink);font-weight:600;}
.rc-root .foot b.w{color:#fff;}
.rc-root .rows{display:flex;flex-direction:column;gap:16px;margin-top:34px;}
.rc-root .row{display:grid;grid-template-columns:270px 1fr 62px;align-items:center;gap:18px;}
.rc-root .row .name{font-weight:700;font-size:26px;}
.rc-root .track{height:32px;background:rgba(12,35,64,.06);border-radius:4px;overflow:hidden;}
.rc-root .fill{display:block;height:100%;background:var(--navy);border-radius:4px;}
.rc-root .fill.g{background:var(--green);}
.rc-root .row .val{font-family:var(--font-plex-mono),monospace;font-weight:600;font-size:29px;text-align:right;}
.rc-root .kstrip{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-top:30px;border-top:1px solid rgba(255,255,255,.16);border-bottom:1px solid rgba(255,255,255,.16);}
.rc-root .kstrip .k{padding:22px 24px 22px 0;border-right:1px solid rgba(255,255,255,.16);}
.rc-root .kstrip .k:last-child{border-right:none;}
.rc-root .kstrip .k:not(:first-child){padding-left:24px;}
.rc-root .kstrip .n{font-family:var(--font-plex-mono),monospace;font-weight:600;font-size:52px;line-height:1;letter-spacing:-.03em;color:#fff;}
.rc-root .kstrip .n.g{color:var(--green-b);}
.rc-root .kstrip .l{font-size:17px;line-height:1.3;color:var(--lt-body);margin-top:12px;}
.rc-root ul.pts{list-style:none;margin:20px 0 0;padding:0;display:flex;flex-direction:column;gap:22px;}
.rc-root ul.pts li{position:relative;padding-left:42px;font-size:29px;line-height:1.42;color:var(--lt-body);font-weight:500;}
.rc-root ul.pts li:before{content:"";position:absolute;left:0;top:14px;width:22px;height:4px;background:var(--green-b);}
.rc-root ul.pts b{color:#fff;font-weight:800;}
.rc-root .tag{display:inline-flex;align-items:center;gap:10px;font-family:var(--font-plex-mono),monospace;font-size:17px;letter-spacing:.08em;text-transform:uppercase;color:var(--green-b);font-weight:600;}
.rc-root .tag .dot{width:11px;height:11px;border-radius:50%;background:var(--green-b);}
.rc-root .evi{font-family:var(--font-plex-mono),monospace;font-size:16px;line-height:1.55;color:var(--lt-body);border-left:3px solid var(--green-b);padding-left:20px;margin-top:18px;max-width:920px;}
`;
